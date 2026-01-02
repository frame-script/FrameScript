use std::{
    collections::{BTreeSet, HashMap, VecDeque},
    process::Stdio,
    sync::{
        Arc, LazyLock, Mutex, RwLock,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Duration,
};

use tokio::{io::AsyncReadExt, process::Command, sync::Notify, time::timeout};

use crate::{
    ffmpeg::{bin::ffmpeg_path, hw_decoder, probe_video_fps},
    future::SharedManualFuture,
};
use tracing::warn;

pub static DECODER: LazyLock<Decoder> = LazyLock::new(|| Decoder::new());
static FPS_CACHE: LazyLock<Mutex<HashMap<String, f64>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

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

    pub async fn clear(&self) {
        let map_clone = {
            let mut map = self.map.lock().unwrap();

            let mut temp = HashMap::new();
            std::mem::swap(&mut temp, &mut map);

            temp
        };

        for decoder in map_clone.values() {
            decoder.close();
        }

        loop {
            // await decode task
            let mut finished = true;
            for decoder in map_clone.values() {
                if decoder.inner.running_decode_tasks.load(Ordering::Relaxed) > 0 {
                    finished = false;
                    break;
                }
            }

            if finished {
                break;
            }

            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        ENTIRE_CACHE_SIZE.store(0, Ordering::Relaxed);
    }

    pub fn clear_session(&self, session_id: u64) {
        let removed = {
            let mut map = self.map.lock().unwrap();
            let mut removed = Vec::new();
            map.retain(|key, decoder| {
                if key.session_id == session_id {
                    removed.push(decoder.clone());
                    false
                } else {
                    true
                }
            });
            removed
        };

        for decoder in removed {
            decoder.close();
        }
    }
}

static ENTIRE_CACHE_SIZE: AtomicUsize = AtomicUsize::new(0);
static MAX_CACHE_SIZE: AtomicUsize = AtomicUsize::new(1024 * 1024 * 1024 * 4); // Default: 4GiB
const STREAM_IDLE_TIMEOUT: Duration = Duration::from_millis(300);
const STREAM_RESTART_GAP: u32 = 90;
const RECENT_FRAME_CACHE: usize = 6;
const FAST_SEEK_BACKOFF_SEC: f64 = 2.0;

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
    pub session_id: u64,
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
    session_id: u64,
    frames: RwLock<HashMap<u32, SharedManualFuture<Vec<u8>>>>,
    pending_frames: Mutex<BTreeSet<u32>>,
    pinned_frame: Mutex<Option<u32>>,
    recent_frames: Mutex<VecDeque<u32>>,
    stream_notify: Notify,
    stream_running: AtomicBool,
    closed: AtomicBool,
    running_decode_tasks: AtomicUsize,
}

impl CachedDecoder {
    fn new(key: DecoderKey) -> Self {
        let inner = Inner {
            path: key.path,
            width: key.width,
            height: key.height,
            session_id: key.session_id,
            frames: RwLock::new(HashMap::new()),
            pending_frames: Mutex::new(BTreeSet::new()),
            pinned_frame: Mutex::new(None),
            recent_frames: Mutex::new(VecDeque::new()),
            stream_notify: Notify::new(),
            stream_running: AtomicBool::new(false),
            closed: AtomicBool::new(false),
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
                    let pending_snapshot = {
                        let pending = self_clone.inner.pending_frames.lock().unwrap();
                        pending.clone()
                    };
                    let pinned_frame = *self_clone.inner.pinned_frame.lock().unwrap();
                    let recent_snapshot = {
                        let recent = self_clone.inner.recent_frames.lock().unwrap();
                        recent.iter().cloned().collect::<BTreeSet<_>>()
                    };

                    let mut frames = self_clone.inner.frames.write().unwrap();

                    let all_frame_index = frames.keys().cloned().collect::<Vec<_>>();

                    for frame_index in all_frame_index.into_iter().rev() {
                        if Some(frame_index) == pinned_frame {
                            continue;
                        }
                        if pending_snapshot.contains(&frame_index) {
                            continue;
                        }
                        if recent_snapshot.contains(&frame_index) {
                            continue;
                        }

                        let future = frames.get(&frame_index).unwrap();
                        if future.is_completed() {
                            let future = frames.remove(&frame_index).unwrap();

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
        let future = {
            let mut frames = self.inner.frames.write().unwrap();
            frames
                .entry(frame_index)
                .or_insert_with(|| SharedManualFuture::new())
                .clone()
        };

        if let Some(frame) = future.get_now() {
            return self.finish_frame(frame_index, frame);
        }

        {
            let mut pinned = self.inner.pinned_frame.lock().unwrap();
            if pinned.is_none() {
                *pinned = Some(frame_index);
            }
        }

        {
            let mut pending = self.inner.pending_frames.lock().unwrap();
            pending.insert(frame_index);
        }
        self.ensure_stream_task();
        self.inner.stream_notify.notify_one();

        let frame = loop {
            match timeout(Duration::from_secs(1), future.get()).await {
                Ok(result) => break result,
                Err(_) => {
                    if self.inner.running_decode_tasks.load(Ordering::Relaxed) > 0 {
                        continue;
                    }

                    {
                        let mut pending = self.inner.pending_frames.lock().unwrap();
                        pending.remove(&frame_index);
                    }

                    // 多分ドロップフレーム
                    // frame_indexに穴がある場合は直前のフレームを返す
                    let mut fallback_index = frame_index;
                    let fallback = loop {
                        match fallback_index.checked_sub(1) {
                            Some(new_index) => {
                                fallback_index = new_index;
                                let frames = self.inner.frames.read().unwrap();
                                match frames.get(&fallback_index) {
                                    Some(future) => match future.get_now() {
                                        Some(result) => break result,
                                        None => continue,
                                    },
                                    None => continue,
                                }
                            }
                            None => {
                                break Arc::new(generate_empty_frame(
                                    self.inner.width,
                                    self.inner.height,
                                ));
                            }
                        }
                    };
                    break fallback;
                }
            }
        };

        self.finish_frame(frame_index, frame)
    }

    fn ensure_stream_task(&self) {
        if self.inner.stream_running.swap(true, Ordering::Relaxed) {
            return;
        }

        self.inner
            .running_decode_tasks
            .fetch_add(1, Ordering::Relaxed);
        let inner = self.inner.clone();
        tokio::spawn(async move {
            run_stream_loop(inner.clone()).await;
            inner.stream_running.store(false, Ordering::Relaxed);
            inner.running_decode_tasks.fetch_sub(1, Ordering::Relaxed);
        });
    }

    fn finish_frame(&self, frame_index: u32, frame: Arc<Vec<u8>>) -> Arc<Vec<u8>> {
        let pinned = *self.inner.pinned_frame.lock().unwrap();
        if Some(frame_index) != pinned {
            let mut recent = self.inner.recent_frames.lock().unwrap();
            if recent.back().copied() != Some(frame_index) {
                recent.push_back(frame_index);
            }
            while recent.len() > RECENT_FRAME_CACHE {
                let drop_index = recent.pop_front();
                if drop_index == pinned {
                    continue;
                }
                if let Some(drop_index) = drop_index {
                    let removed = self.inner.frames.write().unwrap().remove(&drop_index);
                    if let Some(future) = removed {
                        if let Some(cached) = future.get_now() {
                            ENTIRE_CACHE_SIZE.fetch_sub(cached.len(), Ordering::Relaxed);
                        }
                    }
                }
            }
        }
        frame
    }

    fn close(&self) {
        self.inner.closed.store(true, Ordering::Relaxed);
        self.inner.stream_notify.notify_one();
    }
}

struct FrameStream {
    child: tokio::process::Child,
    stdout: tokio::process::ChildStdout,
    frame_size: usize,
    next_frame: u32,
    use_hwaccel: bool,
}

impl FrameStream {
    async fn spawn(
        path: &str,
        start_frame: u32,
        dst_width: u32,
        dst_height: u32,
        use_hwaccel: bool,
    ) -> Result<Self, String> {
        let frame_size = (dst_width as usize)
            .saturating_mul(dst_height as usize)
            .saturating_mul(4);
        if frame_size == 0 {
            return Err("invalid output size".to_string());
        }

        let fps = {
            let mut cache = FPS_CACHE.lock().unwrap();
            if let Some(value) = cache.get(path).copied() {
                value
            } else {
                let value = probe_video_fps(path).unwrap_or(60.0);
                cache.insert(path.to_string(), value);
                value
            }
        };
        let target_sec = (start_frame as f64) / fps.max(1.0);
        let backoff = target_sec.min(FAST_SEEK_BACKOFF_SEC);
        let fast_seek = target_sec - backoff;

        let filter = format!("trim=start_frame=0,scale={}x{}", dst_width, dst_height);

        let ffmpeg = ffmpeg_path()?;
        let mut cmd = Command::new(ffmpeg);
        cmd.arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-nostdin");
        if fast_seek > 0.0 {
            cmd.arg("-ss").arg(format!("{:.6}", fast_seek));
        }
        if use_hwaccel {
            cmd.arg("-hwaccel").arg("auto");
        }
        cmd.arg("-i").arg(path);
        if backoff > 0.0 {
            cmd.arg("-ss").arg(format!("{:.6}", backoff));
        }
        cmd.arg("-vf")
            .arg(filter)
            .arg("-an")
            .arg("-vsync")
            .arg("0")
            .arg("-f")
            .arg("rawvideo")
            .arg("-pix_fmt")
            .arg("rgba")
            .arg("pipe:1");

        cmd.stdout(Stdio::piped()).stderr(Stdio::inherit());

        let mut child = cmd
            .spawn()
            .map_err(|error| format!("failed to run ffmpeg: {error}"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "failed to open ffmpeg stdout".to_string())?;

        Ok(Self {
            child,
            stdout,
            frame_size,
            next_frame: start_frame,
            use_hwaccel,
        })
    }

    async fn read_next(&mut self) -> Result<Vec<u8>, String> {
        let mut frame = vec![0u8; self.frame_size];
        self.stdout
            .read_exact(&mut frame)
            .await
            .map_err(|error| format!("failed to read ffmpeg output: {error}"))?;
        self.next_frame = self.next_frame.saturating_add(1);
        Ok(frame)
    }

    async fn shutdown(&mut self) {
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }
}

async fn run_stream_loop(inner: Arc<Inner>) {
    let mut stream: Option<FrameStream> = None;
    let mut current_frame: u32 = 0;

    loop {
        if inner.closed.load(Ordering::Relaxed) {
            break;
        }

        let target = {
            let pending = inner.pending_frames.lock().unwrap();
            pending.iter().next().cloned()
        };

        let Some(target_frame) = target else {
            let _ = timeout(STREAM_IDLE_TIMEOUT, inner.stream_notify.notified()).await;
            continue;
        };

        let restart = match stream.as_ref() {
            None => true,
            Some(_) => {
                target_frame < current_frame
                    || target_frame.saturating_sub(current_frame) > STREAM_RESTART_GAP
            }
        };

        if restart {
            if let Some(mut old) = stream.take() {
                old.shutdown().await;
            }

            stream = match FrameStream::spawn(
                &inner.path,
                target_frame,
                inner.width,
                inner.height,
                true,
            )
            .await
            {
                Ok(stream) => Some(stream),
                Err(hw_err) => match FrameStream::spawn(
                    &inner.path,
                    target_frame,
                    inner.width,
                    inner.height,
                    false,
                )
                .await
                {
                    Ok(stream) => Some(stream),
                    Err(sw_err) => {
                        let _ = hw_err;
                        let _ = sw_err;
                        complete_pending_with_fallback(inner.clone()).await;
                        continue;
                    }
                },
            };

            current_frame = target_frame;
        }

        let Some(stream_ref) = stream.as_mut() else {
            continue;
        };

        while current_frame <= target_frame {
            if let Some(min_pending) = {
                let pending = inner.pending_frames.lock().unwrap();
                pending.iter().next().cloned()
            } {
                if min_pending < current_frame {
                    break;
                }
            }

            let frame = match stream_ref.read_next().await {
                Ok(frame) => frame,
                Err(_) if stream_ref.use_hwaccel => {
                    warn!(
                        "decoder stream hw read failed session={} frame={}",
                        inner.session_id, current_frame
                    );
                    if let Some(mut old) = stream.take() {
                        old.shutdown().await;
                    }
                    stream = match FrameStream::spawn(
                        &inner.path,
                        current_frame,
                        inner.width,
                        inner.height,
                        false,
                    )
                    .await
                    {
                        Ok(stream) => Some(stream),
                        Err(_) => {
                            warn!(
                                "decoder stream sw fallback spawn failed session={} frame={}",
                                inner.session_id, current_frame
                            );
                            complete_pending_with_fallback(inner.clone()).await;
                            None
                        }
                    };
                    break;
                }
                Err(_) => {
                    warn!(
                        "decoder stream read failed session={} frame={}",
                        inner.session_id, current_frame
                    );
                    complete_pending_with_fallback(inner.clone()).await;
                    if let Some(mut old) = stream.take() {
                        old.shutdown().await;
                    }
                    break;
                }
            };

            let should_complete = {
                let mut pending = inner.pending_frames.lock().unwrap();
                pending.remove(&current_frame)
            };

            if should_complete {
                let future = {
                    let frames = inner.frames.read().unwrap();
                    frames.get(&current_frame).cloned()
                };

                if let Some(future) = future {
                    if !future.is_completed() {
                        ENTIRE_CACHE_SIZE.fetch_add(frame.len(), Ordering::Relaxed);
                        future.complete(Arc::new(frame)).await;
                    }
                }
            }

            current_frame = current_frame.saturating_add(1);
        }
    }

    if let Some(mut old) = stream {
        old.shutdown().await;
    }
}

async fn complete_pending_with_fallback(inner: Arc<Inner>) {
    let pending = {
        let pending = inner.pending_frames.lock().unwrap();
        pending.iter().cloned().collect::<Vec<_>>()
    };

    for frame_index in pending {
        let should_complete = {
            let mut pending = inner.pending_frames.lock().unwrap();
            pending.remove(&frame_index)
        };
        if !should_complete {
            continue;
        }

        let future = {
            let frames = inner.frames.read().unwrap();
            frames.get(&frame_index).cloned()
        };
        if let Some(future) = future {
            if future.is_completed() {
                continue;
            }

            let frame = hw_decoder::extract_frame_hw_rgba(
                &inner.path,
                frame_index as _,
                inner.width,
                inner.height,
            )
            .unwrap_or_else(|_| generate_empty_frame(inner.width, inner.height));
            ENTIRE_CACHE_SIZE.fetch_add(frame.len(), Ordering::Relaxed);
            future.complete(Arc::new(frame)).await;
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
