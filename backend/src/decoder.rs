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
    cache: RwLock<HashMap<usize, Cache>>,
    running: AtomicBool,
}

// Hold cache in 10 seconds!
const GC_THRESHOLD_SECONDS: u64 = 10;
// Cache frames in (frame_index - 10)..(frame_index + 10)
const CACHE_FRAME_RANGE: usize = 10;

impl RealTimeDecoder {
    pub fn new(path: String) -> Self {
        let inner = Inner {
            path,
            cache: RwLock::new(HashMap::new()),
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
                    let mut cache = self_clone.inner.cache.write().unwrap();

                    for key in cache.keys().cloned().collect::<Vec<_>>() {
                        let time = cache.get(&key).unwrap().last_access_time;

                        if time.elapsed().as_secs() > GC_THRESHOLD_SECONDS {
                            //cache.remove(&key);
                        }
                    }
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
        let mut cache = self.inner.cache.write().unwrap();

        match cache.get(&frame_index) {
            Some(cache) => cache.frame.clone(),
            None => {
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

                cache.insert(frame_index, Cache::new(future.clone()));

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
}

impl Cache {
    pub fn new(frame: SharedManualFuture<Vec<u8>>) -> Self {
        Self {
            frame,
            last_access_time: Instant::now(),
        }
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
