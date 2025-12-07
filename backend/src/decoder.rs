use std::{
    collections::HashMap,
    sync::{
        Arc, LazyLock, Mutex, RwLock,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

use tracing::warn;

use crate::{ffmpeg::hw_decoder::extract_frame_hw_rgba, future::SharedManualFuture};

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
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CacheKey {
    frame_index: usize,
    width: u32,
    height: u32,
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

// Cache frames in (frame_index - 10)..(frame_index + 10)
const CACHE_FRAME_RANGE: usize = 10;
// Entire cache size(16GB)
const MAX_CACHE_BYTES: usize = 1024 * 16 * 1024 * 1024;

impl RealTimeDecoder {
    pub fn new(path: String) -> Self {
        let inner = Inner {
            path,
            cache: RwLock::new(CacheState::new()),
            running: AtomicBool::new(false),
        };
        Self {
            inner: Arc::new(inner),
        }
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

    async fn get_frame(
        &self,
        width: u32,
        height: u32,
        frame_index: usize,
    ) -> SharedManualFuture<Vec<u8>> {
        let mut state = self.inner.cache.write().unwrap();
        let key = CacheKey {
            frame_index,
            width,
            height,
        };

        match state.entries.get_mut(&key) {
            Some(cache) => {
                cache.touch();
                cache.frame.clone()
            }
            None => {
                let byte_size = width as usize * height as usize * 4;
                let future = SharedManualFuture::new();

                let self_clone = self.clone();
                let future_clone = future.clone();
                tokio::spawn(async move {
                    let result =
                        extract_frame_hw_rgba(&self_clone.inner.path, frame_index, width, height);

                    match result {
                        Ok(result) => {
                            future_clone.complete(Arc::new(result)).await;
                        }
                        Err(error) => {
                            warn!("failed to decode! : {}", error);

                            future_clone
                                .complete(Arc::new(generate_dummy_frame(width, height)))
                                .await;
                        }
                    }
                });

                state
                    .entries
                    .insert(key.clone(), Cache::new(future.clone(), byte_size));
                state.total_bytes = state.total_bytes.saturating_add(byte_size);
                evict_over_capacity(&mut state);

                future
            }
        }
    }

    pub async fn request_frame(&self, width: u32, height: u32, frame_index: usize) -> Arc<Vec<u8>> {
        let frame_range = (frame_index.checked_sub(CACHE_FRAME_RANGE).unwrap_or(0))
            ..(frame_index + CACHE_FRAME_RANGE);

        for frame_index in frame_range {
            self.get_frame(width, height, frame_index).await;
        }

        self.get_frame(width, height, frame_index).await.get().await
    }
}

#[derive(Debug)]
pub struct Cache {
    pub frame: SharedManualFuture<Vec<u8>>,
    pub last_access_time: Instant,
    pub byte_size: usize,
}

impl Cache {
    pub fn new(frame: SharedManualFuture<Vec<u8>>, byte_size: usize) -> Self {
        Self {
            frame,
            last_access_time: Instant::now(),
            byte_size,
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
