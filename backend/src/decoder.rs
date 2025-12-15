use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc, LazyLock, Mutex, RwLock,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use tokio::time::timeout;

use crate::{ffmpeg::hw_decoder, future::SharedManualFuture};

pub static DECODER: LazyLock<Decoder> = LazyLock::new(|| Decoder::new());

pub struct Decoder {
    map: Mutex<HashMap<DecoderKey, CachedDecoder>>,
}

impl Decoder {
    fn new() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
        }
    }

    pub async fn cached_decoder(&self, key: DecoderKey) -> CachedDecoder {
        let mut generated = false;
        let decoder = self
            .map
            .lock()
            .unwrap()
            .entry(key.clone())
            .or_insert_with(|| {
                generated = true;
                CachedDecoder::new(key)
            })
            .clone();

        if generated {
            decoder.schedule_gc().await;
        }

        decoder
    }
}

static ENTIRE_CACHE_SIZE: AtomicUsize = AtomicUsize::new(0);
static MAX_CACHE_SIZE: AtomicUsize = AtomicUsize::new(1024 * 1024 * 1024 * 4); // Default: 4GiB

pub fn set_max_cache_size(bytes: usize) {
    MAX_CACHE_SIZE.store(bytes.max(1024 * 1024), Ordering::Relaxed);
}

pub fn get_cache_usage() -> (usize, usize) {
    (
        ENTIRE_CACHE_SIZE.load(Ordering::Relaxed),
        MAX_CACHE_SIZE.load(Ordering::Relaxed),
    )
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DecoderKey {
    pub path: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone)]
pub struct CachedDecoder {
    inner: Arc<Inner>,
}

#[derive(Debug)]
struct Inner {
    path: String,
    width: u32,
    height: u32,
    frames: RwLock<HashMap<u32, SharedManualFuture<Vec<u8>>>>,
    frame_states: RwLock<HashMap<u32, FrameState>>,
    decoding_frames: Mutex<HashSet<u32>>,
    running_decode_tasks: AtomicUsize,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
enum FrameState {
    None,
    Wait,
    Drop,
}

impl CachedDecoder {
    fn new(key: DecoderKey) -> Self {
        let inner = Inner {
            path: key.path,
            width: key.width,
            height: key.height,
            frames: RwLock::new(HashMap::new()),
            frame_states: RwLock::new(HashMap::new()),
            decoding_frames: Mutex::new(HashSet::new()),
            running_decode_tasks: AtomicUsize::new(0),
        };
        Self {
            inner: Arc::new(inner),
        }
    }

    async fn schedule_gc(&self) {
        let self_clone = self.clone();

        tokio::spawn(async move {
            loop {
                if ENTIRE_CACHE_SIZE.load(Ordering::Relaxed)
                    >= MAX_CACHE_SIZE.load(Ordering::Relaxed)
                {
                    let mut frames = self_clone.inner.frames.write().unwrap();

                    let all_frame_index = frames.keys().cloned().collect::<Vec<_>>();

                    for frame_index in all_frame_index.into_iter().rev() {
                        let future = frames.get(&frame_index).unwrap();
                        let mut frame_states = self_clone.inner.frame_states.write().unwrap();
                        let frame_state = frame_states
                            .get(&frame_index)
                            .cloned()
                            .unwrap_or(FrameState::None);

                        if future.is_completed() && frame_state == FrameState::None {
                            let future = frames.remove(&frame_index).unwrap();
                            frame_states.insert(frame_index, FrameState::Drop);

                            ENTIRE_CACHE_SIZE
                                .fetch_sub(future.get_now().unwrap().len(), Ordering::Relaxed);

                            if ENTIRE_CACHE_SIZE.load(Ordering::Relaxed)
                                < MAX_CACHE_SIZE.load(Ordering::Relaxed)
                            {
                                break;
                            }
                        }
                    }
                }

                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        });
    }

    pub async fn get_frame(&self, frame_index: u32) -> Arc<Vec<u8>> {
        {
            let mut decoding_frames = self.inner.decoding_frames.lock().unwrap();

            const DECODE_CHUNK: u32 = 120;

            if !decoding_frames.contains(&frame_index) {
                let mut last_frame = frame_index;
                for frame_index in frame_index..(frame_index + DECODE_CHUNK) {
                    if decoding_frames.contains(&frame_index) {
                        break;
                    }
                    last_frame = frame_index;
                }

                for frame_index in frame_index..=last_frame {
                    decoding_frames.insert(frame_index);
                }

                self.inner
                    .running_decode_tasks
                    .fetch_add(1, Ordering::Relaxed);

                let self_clone = self.clone();

                tokio::spawn(async move {
                    let result = hw_decoder::extract_frame_window_hw_rgba(
                        &self_clone.inner.path,
                        frame_index as _,
                        last_frame as _,
                        self_clone.inner.width,
                        self_clone.inner.height,
                    );

                    match result {
                        Ok(result) => {
                            let futures = {
                                let mut frames = self_clone.inner.frames.write().unwrap();

                                let mut futures = Vec::new();
                                for (frame_index, _) in result.iter() {
                                    let future = frames
                                        .entry(*frame_index as _)
                                        .or_insert_with(|| SharedManualFuture::new())
                                        .clone();
                                    futures.push(future);
                                }

                                futures
                            };

                            for (future, (_, frame)) in futures.into_iter().zip(result.into_iter())
                            {
                                ENTIRE_CACHE_SIZE.fetch_add(frame.len(), Ordering::Relaxed);
                                future.complete(Arc::new(frame)).await;
                            }
                        }
                        Err(_) => todo!(),
                    }

                    self_clone
                        .inner
                        .running_decode_tasks
                        .fetch_sub(1, Ordering::Relaxed);
                });
            }
        }

        {
            let frame_state = {
                let mut frame_states = self.inner.frame_states.write().unwrap();

                let frame_state = frame_states
                    .get(&frame_index)
                    .cloned()
                    .unwrap_or(FrameState::None);

                frame_states.insert(frame_index, FrameState::Wait);

                frame_state
            };

            if let FrameState::Drop | FrameState::Wait = frame_state {
                let result = hw_decoder::extract_frame_hw_rgba(
                    &self.inner.path,
                    frame_index as _,
                    self.inner.width,
                    self.inner.height,
                );

                match result {
                    Ok(result) => {
                        return Arc::new(result);
                    }
                    Err(_) => todo!(),
                }
            }
        }

        let future = {
            let mut frames = self.inner.frames.write().unwrap();

            frames
                .entry(frame_index)
                .or_insert_with(|| SharedManualFuture::new())
                .clone()
        };

        let frame;

        loop {
            match timeout(Duration::from_secs(1), future.get()).await {
                Ok(result) => {
                    frame = result;
                    break;
                }
                Err(_) => match self.inner.running_decode_tasks.load(Ordering::Relaxed) > 0 {
                    true => continue,
                    false => {
                        // 多分ドロップフレーム
                        // frame_indexに穴がある場合
                        // 直前のフレームを持ってくる
                        let mut frame_index = frame_index;
                        loop {
                            match frame_index.checked_sub(1) {
                                Some(new_index) => {
                                    frame_index = new_index;

                                    let frames = self.inner.frames.read().unwrap();

                                    match frames.get(&frame_index) {
                                        Some(future) => match future.get_now() {
                                            Some(result) => {
                                                frame = result;
                                                break;
                                            }
                                            None => continue,
                                        },
                                        None => continue,
                                    }
                                }
                                None => {
                                    frame = Arc::new(generate_empty_frame(
                                        self.inner.width,
                                        self.inner.height,
                                    ));
                                    break;
                                }
                            }
                        }

                        break;
                    }
                },
            }
        }

        {
            // 送信が終わったフレームは解放する。
            // ただし、フロントエンドのcurrentFrameの初期値が0なので、
            // frame_index = 0のリクエストが複数飛んでくる。
            // 0の場合に解放してしまうと、後方のレスポンスが帰らずに無限に待たせてしまう。
            // おそらく、もっと良いロジックがあるが、一旦は0のみ解放しないことで実装する。
            if frame_index != 0 {
                ENTIRE_CACHE_SIZE.fetch_sub(frame.len(), Ordering::Relaxed);

                self.inner.frames.write().unwrap().remove(&frame_index);
            }
        }

        frame
    }
}

pub fn generate_empty_frame(width: u32, height: u32) -> Vec<u8> {
    let mut buf = vec![0u8; (width * height * 4) as usize];

    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;

            let r = 255u8;
            let g = 0;
            let b = 0;
            let a = 255u8;

            buf[idx] = r;
            buf[idx + 1] = g;
            buf[idx + 2] = b;
            buf[idx + 3] = a;
        }
    }

    buf
}
