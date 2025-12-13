use std::{
    collections::HashMap,
    num::NonZero,
    sync::{
        Arc, LazyLock, Mutex, RwLock,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use num_threads::num_threads;

use crate::{
    ffmpeg::{
        hw_decoder::{self},
        probe_video_frames,
    },
    future::SharedManualFuture,
};

pub static DECODER: LazyLock<Decoder> = LazyLock::new(|| Decoder::new());

pub struct Decoder {
    decoders: Mutex<HashMap<String, CachedDecoder>>,
}

impl Decoder {
    pub fn new() -> Self {
        Self {
            decoders: Mutex::new(HashMap::new()),
        }
    }

    pub async fn decoder(&self, path: String, width: u32, height: u32) -> CachedDecoder {
        let mut generated = false;
        let decoder = {
            let mut decoders = self.decoders.lock().unwrap();
            decoders
                .entry(path.clone())
                .or_insert_with(|| {
                    generated = true;
                    CachedDecoder::new(path, width, height)
                })
                .clone()
        };

        if generated {
            decoder.start().await;
        }

        decoder
    }
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
    total_frames: AtomicUsize,
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FrameState {
    Wait,
    Drop,
    None,
}

static ENTIRE_CACHE_SIZE: AtomicUsize = AtomicUsize::new(0);
static MAX_CACHE_SIZE: LazyLock<usize> = LazyLock::new(|| {
    match std::env::var("MAX_CACHE_SIZE")
        .ok()
        .map(|size| size.parse::<usize>().ok())
        .flatten()
    {
        Some(size) => size,
        None => 1024 * 1024 * 1024 * 4, // 4GiB
    }
});

impl CachedDecoder {
    pub fn new(path: String, width: u32, height: u32) -> Self {
        let inner = Inner {
            path,
            width,
            height,
            frames: RwLock::new(HashMap::new()),
            frame_states: RwLock::new(HashMap::new()),
            total_frames: AtomicUsize::new(0),
        };

        Self {
            inner: Arc::new(inner),
        }
    }

    pub async fn start(&self) {
        let total_frames = probe_video_frames(&self.inner.path).unwrap_or(0) as usize;
        self.inner
            .total_frames
            .store(total_frames, Ordering::Relaxed);

        if total_frames == 0 {
            return;
        }

        self.schedule_gc().await;

        let workers = num_threads().unwrap_or(NonZero::new(1).unwrap()).get();
        let chunk = total_frames / (workers - 1).max(1);

        for worker_id in 0..workers {
            let worker_start = worker_id * chunk;
            let worker_end = ((worker_id + 1) * chunk).min(total_frames) - 1;

            let self_clone = self.clone();

            tokio::spawn(async move {
                let mut start = worker_start;
                const CHUNK: usize = 120;

                loop {
                    if ENTIRE_CACHE_SIZE.load(Ordering::Relaxed) >= *MAX_CACHE_SIZE {
                        // キャッシュが減るのを待つ
                        tokio::time::sleep(Duration::from_secs(1)).await;
                    }

                    let end = (start + CHUNK).min(worker_end);
                    let result = hw_decoder::extract_frame_window_hw_rgba(
                        &self_clone.inner.path,
                        start,
                        end,
                        self_clone.inner.width,
                        self_clone.inner.height,
                    );

                    match result {
                        Ok(result) => {
                            let mut futures = Vec::new();

                            {
                                let mut frames = self_clone.inner.frames.write().unwrap();

                                for (index, frame) in result {
                                    let future = frames
                                        .entry(index as _)
                                        .or_insert_with(|| SharedManualFuture::new())
                                        .clone();
                                    futures.push((future, frame));
                                }
                            }

                            for (future, frame) in futures {
                                ENTIRE_CACHE_SIZE.fetch_add(frame.len(), Ordering::Relaxed);
                                future.complete(Arc::new(frame)).await;
                            }
                        }
                        Err(_) => todo!(),
                    }

                    if end == worker_end {
                        break;
                    }
                    start = end;
                }
            });
        }
    }

    async fn schedule_gc(&self) {
        let self_clone = self.clone();

        tokio::spawn(async move {
            loop {
                if ENTIRE_CACHE_SIZE.load(Ordering::Relaxed) >= *MAX_CACHE_SIZE {
                    let mut frames = self_clone.inner.frames.write().unwrap();

                    let all_frame_index = frames.keys().cloned().collect::<Vec<_>>();

                    for frame_index in all_frame_index {
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

                            if ENTIRE_CACHE_SIZE.load(Ordering::Relaxed) < *MAX_CACHE_SIZE {
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
            let mut frame_states = self.inner.frame_states.write().unwrap();
            let frame_state = frame_states
                .get(&frame_index)
                .cloned()
                .unwrap_or(FrameState::None);

            if frame_state == FrameState::Wait || frame_state == FrameState::Drop {
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
            frame_states.insert(frame_index, FrameState::Wait);
        }

        let future = {
            let mut frames = self.inner.frames.write().unwrap();

            frames
                .entry(frame_index)
                .or_insert_with(|| SharedManualFuture::new())
                .clone()
        };

        let frame = future.get().await;

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

    pub fn total_frames(&self) -> Option<usize> {
        let v = self.inner.total_frames.load(Ordering::Relaxed);
        if v > 0 {
            Some(v)
        } else {
            None
        }
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

#[cfg(test)]
mod test {
    use std::time::Instant;

    use tokio::runtime::Builder;

    use crate::{decoder::DECODER, util::resolve_path_to_string};

    #[test]
    fn test() {
        Builder::new_multi_thread()
            .build()
            .unwrap()
            .block_on(async {
                let start = Instant::now();
                let path = resolve_path_to_string("~/Videos/1080p.mp4").unwrap();
                let decoder = DECODER.decoder(path.clone(), 1920, 1080).await;

                let _ = decoder.get_frame(600).await;

                println!("{}[ms]", start.elapsed().as_millis());
            });
    }
}
