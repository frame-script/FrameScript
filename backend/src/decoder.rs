use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc, LazyLock, Mutex, RwLock,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use tokio::sync::mpsc;
use tokio::sync::Notify;
use tracing::warn;

use crate::{ffmpeg::hw_decoder::extract_frame_window_hw_rgba, future::SharedManualFuture};

pub static DECODER: LazyLock<Decoder> = LazyLock::new(|| Decoder::new());

pub struct Decoder {
    decoders: Mutex<HashMap<String, RealTimeDecoder>>,
}

impl Decoder {
    pub fn new() -> Self {
        Self {
            decoders: Mutex::new(HashMap::new()),
        }
    }

    pub async fn decoder(&self, path: String) -> RealTimeDecoder {
        let generated;
        let decoder = {
            let mut decoders = self.decoders.lock().unwrap();
            generated = decoders.get(&path).is_none();
            decoders
                .entry(path.clone())
                .or_insert_with(|| RealTimeDecoder::new(path))
                .clone()
        };

        if generated {
            decoder.schedule_gc().await;
        }

        decoder
    }
}

#[derive(Debug, Clone)]
pub struct RealTimeDecoder {
    inner: Arc<Inner>,
}

#[derive(Debug)]
struct Inner {
    path: String,
    cache: RwLock<CacheState>,
    running: AtomicBool,
    pending: Mutex<HashSet<CacheKey>>,
    low_tx: mpsc::Sender<DecodeTask>,
    generation: AtomicU64,
    latest_task: Mutex<Option<DecodeTask>>,
    notify: Notify,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Copy)]
struct CacheKey {
    frame_index: usize,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Priority {
    High,
    Low,
}

#[derive(Debug, Clone, Copy)]
struct DecodeTask {
    key: CacheKey,
    width: u32,
    height: u32,
    priority: Priority,
    generation: u64,
}

#[derive(Debug)]
struct CacheState {
    entries: HashMap<CacheKey, Cache>,
    total_bytes: usize,
}

impl CacheState {
    fn new() -> Self {
        Self {
            entries: HashMap::new(),
            total_bytes: 0,
        }
    }
}

// Cache frames in frame_index..=frame_index + CACHE_FRAME_RANGE
const CACHE_FRAME_RANGE: usize = 60;
// Entire cache size(16GB)
const MAX_CACHE_BYTES: usize = 1024 * 16 * 1024 * 1024;

impl RealTimeDecoder {
    pub fn new(path: String) -> Self {
        let (low_tx, low_rx) = mpsc::channel(1);
        let inner = Inner {
            path,
            cache: RwLock::new(CacheState::new()),
            running: AtomicBool::new(false),
            pending: Mutex::new(HashSet::new()),
            low_tx: low_tx.clone(),
            generation: AtomicU64::new(0),
            latest_task: Mutex::new(None),
            notify: Notify::new(),
        };
        let this = Self {
            inner: Arc::new(inner),
        };
        this.start_worker(low_rx);
        this
    }

    async fn schedule_gc(&self) {
        let self_clone = self.clone();

        tokio::spawn(async move {
            self_clone.inner.running.store(true, Ordering::Relaxed);

            loop {
                if !self_clone.inner.running.load(Ordering::Relaxed) {
                    break;
                }

                {
                    let mut state = self_clone.inner.cache.write().unwrap();
                    evict_over_capacity(&mut state);
                }

                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        });
    }

    fn start_worker(&self, mut low_rx: mpsc::Receiver<DecodeTask>) {
        let self_clone = self.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = self_clone.inner.notify.notified() => {
                        let task_opt = {
                            let mut slot = self_clone.inner.latest_task.lock().unwrap();
                            slot.take()
                        };
                        if let Some(task) = task_opt {
                            self_clone.process_task(task).await;
                        }
                    }
                    Some(task) = low_rx.recv() => {
                        // 低優先度は補助的に処理
                        self_clone.process_task(task).await;
                    }
                    else => break,
                }
            }
        });
    }

    async fn process_task(&self, task: DecodeTask) {
        let DecodeTask {
            key,
            width,
            height,
            generation,
            ..
        } = task;

        // 新しい世代が来ていれば古いタスクはスキップ（完了しないまま新しいタスクが同じ Future を満たす）
        let latest = self.inner.generation.load(Ordering::Relaxed);
        if generation < latest {
            {
                let mut pending = self.inner.pending.lock().unwrap();
                pending.remove(&key);
            }
            return;
        }

        let result = extract_frame_window_hw_rgba(
            &self.inner.path,
            key.frame_index,
            key.frame_index,
            width,
            height,
        );

        let mut completes: Vec<(SharedManualFuture<Vec<u8>>, Arc<Vec<u8>>)> = Vec::new();

        match result {
            Ok(frames) => {
                let mut state = self.inner.cache.write().unwrap();

                for (idx, data) in frames {
                    let key = CacheKey {
                        frame_index: idx,
                        width,
                        height,
                    };
                    let arc_data = Arc::new(data);

                    if let Some(entry) = state.entries.get_mut(&key) {
                        if generation < entry.generation {
                            continue;
                        }
                        entry.touch();
                        entry.generation = generation;
                        if !entry.ready {
                            entry.ready = true;
                            completes.push((entry.frame.clone(), arc_data.clone()));
                        }
                    } else {
                        let f = SharedManualFuture::new_completed((*arc_data).clone());
                        state.entries.insert(
                            key.clone(),
                            Cache::completed(
                                f.clone(),
                                width as usize * height as usize * 4,
                                generation,
                            ),
                        );
                        state.total_bytes = state
                            .total_bytes
                            .saturating_add(width as usize * height as usize * 4);
                    }
                }

                evict_over_capacity(&mut state);
            }
            Err(error) => {
                warn!("failed to decode! : {}", error);

                let mut state = self.inner.cache.write().unwrap();
                if let Some(entry) = state.entries.get_mut(&key) {
                    if generation < entry.generation {
                        // 新しい世代があるのでスキップ
                    } else if !entry.ready {
                        entry.ready = true;
                        entry.generation = generation;
                        let data = Arc::new(generate_dummy_frame(width, height));
                        completes.push((entry.frame.clone(), data));
                    }
                } else {
                    let data = Arc::new(generate_dummy_frame(width, height));
                    let fut = SharedManualFuture::new_completed((*data).clone());
                    state.entries.insert(
                        key.clone(),
                        Cache::completed(
                            fut.clone(),
                            width as usize * height as usize * 4,
                            generation,
                        ),
                    );
                    state.total_bytes = state
                        .total_bytes
                        .saturating_add(width as usize * height as usize * 4);
                }
            }
        }

        {
            let mut pending = self.inner.pending.lock().unwrap();
            pending.remove(&key);
        }

        for (fut, data) in completes {
            fut.complete(data.clone()).await;
        }
    }

    async fn get_frame(
        &self,
        width: u32,
        height: u32,
        frame_index: usize,
        priority: Priority,
        generation: u64,
    ) -> SharedManualFuture<Vec<u8>> {
        let key = CacheKey {
            frame_index,
            width,
            height,
        };

        let mut enqueue_task: Option<DecodeTask> = None;
        let future = {
            let mut state = self.inner.cache.write().unwrap();
            match state.entries.get_mut(&key) {
                Some(cache) => {
                    cache.touch();
                    if !cache.ready && generation > cache.generation {
                        cache.generation = generation;
                        enqueue_task = Some(DecodeTask {
                            key: key.clone(),
                            width,
                            height,
                            priority,
                            generation,
                        });
                    }
                    cache.frame.clone()
                }
                None => {
                    let byte_size = width as usize * height as usize * 4;
                    let future = SharedManualFuture::new();

                    state
                        .entries
                        .insert(key.clone(), Cache::pending(future.clone(), byte_size, generation));
                    state.total_bytes = state.total_bytes.saturating_add(byte_size);

                    evict_over_capacity(&mut state);

                    {
                        let mut pending = self.inner.pending.lock().unwrap();
                        pending.insert(key.clone());
                    }

                    enqueue_task = Some(DecodeTask {
                        key: key.clone(),
                        width,
                        height,
                        priority,
                        generation,
                    });

                    future
                }
            }
        };

        if let Some(task) = enqueue_task {
            match priority {
                Priority::High => {
                    {
                        let mut slot = self.inner.latest_task.lock().unwrap();
                        *slot = Some(task);
                    }
                    self.inner.notify.notify_one();
                }
                Priority::Low => {
                    let _ = self.inner.low_tx.try_send(task);
                }
            }
        }

        future
    }

    pub async fn request_frame(&self, width: u32, height: u32, frame_index: usize) -> Arc<Vec<u8>> {
        // 世代を更新（新しいフレーム要求を優先させる）
        let generation = self
            .inner
            .generation
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_add(1);

        // 現在フレームを高優先度で要求（最新タスクのみキューに保持）
        let current =
            self.get_frame(width, height, frame_index, Priority::High, generation).await;

        // プリフェッチは停止（GPU キューを最新フレームだけに集中させる）

        current.get().await
    }
}

#[derive(Debug)]
pub struct Cache {
    pub frame: SharedManualFuture<Vec<u8>>,
    pub last_access_time: Instant,
    pub byte_size: usize,
    pub ready: bool,
    pub generation: u64,
}

impl Cache {
    pub fn pending(frame: SharedManualFuture<Vec<u8>>, byte_size: usize, generation: u64) -> Self {
        Self {
            frame,
            last_access_time: Instant::now(),
            byte_size,
            ready: false,
            generation,
        }
    }

    pub fn completed(frame: SharedManualFuture<Vec<u8>>, byte_size: usize, generation: u64) -> Self {
        Self {
            frame,
            last_access_time: Instant::now(),
            byte_size,
            ready: true,
            generation,
        }
    }

    pub fn touch(&mut self) {
        self.last_access_time = Instant::now();
    }
}

fn generate_dummy_frame(width: u32, height: u32) -> Vec<u8> {
    let mut buf = vec![0u8; (width * height * 4) as usize];

    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;

            let r = (x * 255 / width) as u8;
            let g = (y * 255 / height) as u8;
            let b = 128u8;
            let a = 255u8;

            buf[idx] = r;
            buf[idx + 1] = g;
            buf[idx + 2] = b;
            buf[idx + 3] = a;
        }
    }

    buf
}

fn evict_over_capacity(state: &mut CacheState) {
    if state.total_bytes <= MAX_CACHE_BYTES {
        return;
    }

    let mut entries: Vec<_> = state
        .entries
        .iter()
        .map(|(k, v)| (k.clone(), v.last_access_time, v.byte_size))
        .collect();

    entries.sort_by_key(|(_, t, _)| *t);

    for (key, _, size) in entries {
        if state.total_bytes <= MAX_CACHE_BYTES {
            break;
        }
        if state.entries.remove(&key).is_some() {
            state.total_bytes = state.total_bytes.saturating_sub(size);
        }
    }
}
