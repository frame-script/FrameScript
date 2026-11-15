//! Writing a composition out as a video file, with its sound.
//!
//! The frames are shared out among workers, each a thread with a composition (V8 and a document),
//! a GPU device and an encoder (the system's `ffmpeg`) of its own: a frame is a pure function of
//! its number, so it can be made anywhere. Each worker goes through a stretch of the frames in
//! order, which its videos decode in order, and writes them to a file; one that is done first
//! takes the second half of what another has left. Meanwhile the sound is mixed from the same
//! plan the preview plays. At the end the pieces are joined as they are, without encoding again,
//! and the sound is put with them.

use crate::composition::Composition;
use crate::media::Media;
use crate::render::{OffscreenRenderer, yuv_size};
use crate::sound::{AudioPlan, RATE};
use std::io::{Read, Write};
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{SyncSender, sync_channel};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// How often progress is told.
const REPORT: Duration = Duration::from_millis(100);
/// How far back the rate is taken from.
const RATE_OVER: Duration = Duration::from_secs(2);
/// Frames a worker has drawn that wait for its encoder, at most.
const QUEUE: usize = 2;
/// What the decoded frames of a worker's videos may take: it goes through them in order.
const WORKER_CACHE: usize = 512 << 20;
/// Frames that are left to a worker rather than shared, in seconds: taking them over costs going
/// to a key frame in every video, and starting an encoder.
const LEAST_SHARED: f64 = 1.0;
/// How long the sound of a second may take to decode.
const SOUND_WAIT: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Codec {
    H264,
    H265,
    Av1,
    ProRes,
    /// On the GPU, through VA-API (Linux).
    H264Vaapi,
    H265Vaapi,
}

impl Codec {
    pub const ALL: [Codec; 6] = [
        Codec::H264,
        Codec::H265,
        Codec::Av1,
        Codec::ProRes,
        Codec::H264Vaapi,
        Codec::H265Vaapi,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Codec::H264 => "H.264 (MP4)",
            Codec::H265 => "H.265 / HEVC (MP4)",
            Codec::Av1 => "AV1 (MP4)",
            Codec::ProRes => "ProRes 422 HQ (MOV)",
            Codec::H264Vaapi => "H.264, GPU (MP4, VA-API)",
            Codec::H265Vaapi => "H.265, GPU (MP4, VA-API)",
        }
    }

    /// For the command line: `h264`, `h265`, `av1`, `prores`, `h264-vaapi`, `h265-vaapi`.
    pub fn name(self) -> &'static str {
        match self {
            Codec::H264 => "h264",
            Codec::H265 => "h265",
            Codec::Av1 => "av1",
            Codec::ProRes => "prores",
            Codec::H264Vaapi => "h264-vaapi",
            Codec::H265Vaapi => "h265-vaapi",
        }
    }

    pub fn from_name(name: &str) -> Option<Codec> {
        Codec::ALL.into_iter().find(|c| c.name() == name)
    }

    /// Of the file it goes in.
    pub fn extension(self) -> &'static str {
        match self {
            Codec::ProRes => "mov",
            _ => "mp4",
        }
    }

    /// The encoder of FFmpeg.
    fn encoder(self) -> &'static str {
        match self {
            Codec::H264 => "libx264",
            Codec::H265 => "libx265",
            Codec::Av1 => "libsvtav1",
            Codec::ProRes => "prores_ks",
            Codec::H264Vaapi => "h264_vaapi",
            Codec::H265Vaapi => "hevc_vaapi",
        }
    }

    /// Whether it is on the GPU: the encoder takes few threads, and the speed means nothing.
    pub fn is_hardware(self) -> bool {
        matches!(self, Codec::H264Vaapi | Codec::H265Vaapi)
    }

    /// Whether it is given YUV 4:2:0 made on the GPU, rather than RGBA it converts itself.
    fn takes_yuv420(self) -> bool {
        self != Codec::ProRes
    }

    /// The constant rate factor it can be given (lower is better and bigger), or `None` if it
    /// has none.
    pub fn quality_range(self) -> Option<(u32, u32)> {
        match self {
            Codec::H264 | Codec::H265 | Codec::H264Vaapi | Codec::H265Vaapi => Some((0, 51)),
            Codec::Av1 => Some((0, 63)),
            Codec::ProRes => None,
        }
    }

    /// Hard to tell from the project on most screens.
    pub fn default_quality(self) -> u32 {
        match self {
            Codec::H264 => 18,
            Codec::H265 => 20,
            Codec::H264Vaapi | Codec::H265Vaapi => 20,
            Codec::Av1 => 28,
            Codec::ProRes => 0,
        }
    }

    fn arguments(self, quality: u32, speed: Speed) -> Vec<String> {
        let x26x = match speed {
            Speed::Fast => "veryfast",
            Speed::Medium => "medium",
            Speed::Slow => "slow",
        };
        let mut args: Vec<String> = vec!["-c:v".into(), self.encoder().into()];
        match self {
            Codec::H264 => args.extend(["-preset", x26x, "-crf"].map(String::from)),
            Codec::H265 => args.extend(
                [
                    "-preset",
                    x26x,
                    "-tag:v",
                    "hvc1",
                    "-x265-params",
                    "log-level=error",
                    "-crf",
                ]
                .map(String::from),
            ),
            Codec::Av1 => {
                let preset = match speed {
                    Speed::Fast => "10",
                    Speed::Medium => "8",
                    Speed::Slow => "5",
                };
                args.extend(["-preset", preset, "-crf"].map(String::from));
            }
            Codec::ProRes => {
                args.extend(["-profile:v", "3", "-vendor", "apl0"].map(String::from));
                return args;
            }
            Codec::H264Vaapi | Codec::H265Vaapi => {
                args.extend(["-rc_mode", "CQP", "-qp"].map(String::from));
            }
        }
        args.push(quality.to_string());
        args
    }

    /// What goes before the input.
    fn input_arguments(self) -> Vec<String> {
        if self.is_hardware() {
            vec![
                "-vaapi_device".into(),
                vaapi_device().to_string_lossy().into_owned(),
            ]
        } else {
            Vec::new()
        }
    }

    /// What the frames go through on the way to the encoder: for ProRes, from RGBA to its
    /// colors (sizes made even for the chroma, and the colors of HD video, as it is marked).
    fn filter(self) -> Vec<String> {
        let filter = match self {
            Codec::ProRes => {
                "pad=ceil(iw/2)*2:ceil(ih/2)*2,scale=out_color_matrix=bt709:out_range=tv,format=yuv422p10le"
            }
            Codec::H264Vaapi | Codec::H265Vaapi => "format=nv12,hwupload",
            _ => return Vec::new(),
        };
        vec!["-vf".into(), filter.into()]
    }

    fn sound(self, kbps: u32) -> Vec<String> {
        match self {
            Codec::ProRes => ["-c:a", "pcm_s16le"].map(String::from).to_vec(),
            _ => vec![
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                format!("{kbps}k"),
            ],
        }
    }
}

/// How long the encoder may take over each frame: longer makes smaller files of the same quality.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Speed {
    Fast,
    Medium,
    Slow,
}

impl Speed {
    pub const ALL: [Speed; 3] = [Speed::Fast, Speed::Medium, Speed::Slow];

    pub fn name(self) -> &'static str {
        match self {
            Speed::Fast => "fast",
            Speed::Medium => "medium",
            Speed::Slow => "slow",
        }
    }

    pub fn from_name(name: &str) -> Option<Speed> {
        Speed::ALL.into_iter().find(|s| s.name() == name)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ExportSettings {
    pub output: PathBuf,
    pub codec: Codec,
    /// See [`Codec::quality_range`].
    pub quality: u32,
    pub speed: Speed,
    /// Of the project's own size. The frames are drawn at the project's size and then made larger
    /// or smaller ([`crate::resample`]), so they are laid out as in the preview.
    pub scale: f64,
    /// The frames to write, the end not among them. `None`: all of them.
    pub range: Option<(u32, u32)>,
    /// How many frames are drawn at once.
    pub workers: usize,
    /// The bit rate of the sound in kb/s, or `None` to leave it out.
    pub audio: Option<u32>,
}

impl ExportSettings {
    pub fn new(output: PathBuf, codec: Codec) -> Self {
        Self {
            output,
            codec,
            quality: codec.default_quality(),
            speed: Speed::Medium,
            scale: 1.0,
            range: None,
            workers: default_workers(),
            audio: Some(192),
        }
    }
}

/// A worker for every 5 threads of the machine, up to 8: each also has an encoder, which takes
/// threads of its own. On 20 threads (a Ryzen AI 9 365), drawing 1500 boxes a frame took 59 s
/// with one worker, 36 s with two and 25 s with four, and eight were no faster than four.
pub fn default_workers() -> usize {
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get());
    (threads / 5).clamp(1, 8)
}

#[derive(Clone, Debug, PartialEq)]
pub enum Stage {
    /// Loading the project.
    Starting,
    Rendering,
    /// Joining the pieces and putting the sound with them.
    Joining,
    Done,
    Failed(String),
    Cancelled,
}

impl Stage {
    pub fn is_over(&self) -> bool {
        matches!(self, Stage::Done | Stage::Failed(_) | Stage::Cancelled)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Progress {
    pub stage: Stage,
    /// Frames drawn and handed to the encoders.
    pub done: u32,
    pub total: u32,
    pub elapsed: Duration,
    /// Frames a second over the last few seconds: what is left will go about as fast.
    pub rate: f64,
    /// Of the frames, in pixels; nothing until the project is loaded.
    pub size: (u32, u32),
    pub output: PathBuf,
}

/// The `ffmpeg` that encodes: `FRAMESCRIPT_FFMPEG`, or the one on the path.
pub fn ffmpeg() -> PathBuf {
    std::env::var_os("FRAMESCRIPT_FFMPEG").map_or_else(|| "ffmpeg".into(), PathBuf::from)
}

/// The device the VA-API codecs encode on: `FRAMESCRIPT_VAAPI_DEVICE`, or the first one.
fn vaapi_device() -> PathBuf {
    std::env::var_os("FRAMESCRIPT_VAAPI_DEVICE")
        .map_or_else(|| "/dev/dri/renderD128".into(), PathBuf::from)
}

/// The codecs the system's `ffmpeg` can encode. Those on the GPU are tried with a frame, which
/// takes a moment.
pub fn available_codecs() -> Result<Vec<Codec>, String> {
    let out = Command::new(ffmpeg())
        .args(["-hide_banner", "-encoders"])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| no_ffmpeg(&e))?;
    let list = String::from_utf8_lossy(&out.stdout);
    let has = |name: &str| {
        list.lines()
            .any(|l| l.split_whitespace().nth(1) == Some(name))
    };
    let works = |c: Codec| {
        if !c.is_hardware() {
            return true;
        }
        let mut args = c.input_arguments();
        args.extend(["-f", "lavfi", "-i", "color=black:s=64x64:d=0.04"].map(String::from));
        args.extend(c.filter());
        args.extend(c.arguments(30, Speed::Fast));
        args.extend(["-f", "null", "-"].map(String::from));
        Command::new(ffmpeg())
            .args(["-hide_banner", "-loglevel", "error"])
            .args(args)
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
    };
    Ok(Codec::ALL
        .into_iter()
        .filter(|&c| has(c.encoder()) && works(c))
        .collect())
}

fn no_ffmpeg(e: &std::io::Error) -> String {
    format!(
        "can't run {} ({e}): exporting needs FFmpeg's command; put it on the path or name it with FRAMESCRIPT_FFMPEG",
        ffmpeg().display()
    )
}

struct Shared {
    /// The workers stop at the next frame.
    stop: AtomicBool,
    /// Because it was asked to, rather than because something failed.
    cancelled: AtomicBool,
    done: AtomicU32,
}

/// An export going on, on threads of its own. Dropping it cancels it and waits for it.
pub struct Export {
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
}

impl Export {
    /// Starts writing the project in `dir` out. `report` is told how it goes, from another
    /// thread, every so often and once at the end.
    pub fn start(
        dir: PathBuf,
        settings: ExportSettings,
        report: impl Fn(Progress) + Send + 'static,
    ) -> Export {
        // FFmpeg reads the paths in the list of pieces from where the list is.
        let mut settings = settings;
        if let Ok(output) = std::path::absolute(&settings.output) {
            settings.output = output;
        }
        let shared = Arc::new(Shared {
            stop: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
            done: AtomicU32::new(0),
        });
        let thread = std::thread::Builder::new()
            .name("framescript-export".into())
            .spawn({
                let shared = shared.clone();
                move || run(&dir, &settings, &shared, &report)
            })
            .expect("a thread can be started");
        Export {
            shared,
            thread: Some(thread),
        }
    }

    /// Stops at the next frame and deletes what was written.
    pub fn cancel(&self) {
        self.shared.cancelled.store(true, Ordering::Relaxed);
        self.shared.stop.store(true, Ordering::Relaxed);
    }

    pub fn is_finished(&self) -> bool {
        self.thread.as_ref().is_none_or(|t| t.is_finished())
    }

    /// Waits for it to end.
    pub fn wait(mut self) {
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for Export {
    fn drop(&mut self) {
        if let Some(thread) = self.thread.take() {
            self.cancel();
            let _ = thread.join();
        }
    }
}

/// What the workers need to know of the project, from loading it once.
struct Job {
    fps: f64,
    /// The frames to write.
    frames: Range<u32>,
    /// What the composition paints.
    project: (u32, u32),
    /// Of the frames written.
    size: (u32, u32),
    plan: Arc<AudioPlan>,
}

fn run(dir: &Path, settings: &ExportSettings, shared: &Shared, report: &dyn Fn(Progress)) {
    let started = Instant::now();
    let mut progress = Progress {
        stage: Stage::Starting,
        done: 0,
        total: 0,
        elapsed: Duration::ZERO,
        rate: 0.0,
        size: (0, 0),
        output: settings.output.clone(),
    };
    report(progress.clone());
    let parts = parts_dir(&settings.output);
    // How many frames were done when, back to the start of the rate.
    let mut samples = std::collections::VecDeque::<(Duration, u32)>::new();
    let outcome = export(dir, settings, shared, &parts, &mut |p: &dyn Fn(
        &mut Progress,
    )| {
        p(&mut progress);
        progress.done = shared.done.load(Ordering::Relaxed);
        progress.elapsed = started.elapsed();
        // From the first frame drawn: what comes before it is loading.
        if progress.done > 0 {
            samples.push_back((progress.elapsed, progress.done));
            while samples.len() > 2 && progress.elapsed - samples[1].0 >= RATE_OVER {
                samples.pop_front();
            }
            let (t, n) = samples[0];
            let seconds = (progress.elapsed - t).as_secs_f64();
            if seconds > 0.0 {
                progress.rate = (progress.done - n) as f64 / seconds;
            }
        }
        report(progress.clone());
    });
    let _ = std::fs::remove_dir_all(&parts);
    progress.stage = match outcome {
        Ok(()) if shared.cancelled.load(Ordering::Relaxed) => Stage::Cancelled,
        Ok(()) => Stage::Done,
        Err(e) => Stage::Failed(e),
    };
    progress.done = shared.done.load(Ordering::Relaxed);
    progress.elapsed = started.elapsed();
    report(progress);
}

/// Changes what is told, and tells it.
type Tell<'a> = dyn FnMut(&dyn Fn(&mut Progress)) + 'a;

/// Where the pieces go: next to the file, so that they can be moved there.
fn parts_dir(output: &Path) -> PathBuf {
    let name = output
        .file_stem()
        .map_or("export".into(), |s| s.to_string_lossy().into_owned());
    let dir = output
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    dir.join(format!(".{name}.framescript-{}", std::process::id()))
}

fn export(
    dir: &Path,
    settings: &ExportSettings,
    shared: &Shared,
    parts: &Path,
    tell: &mut Tell,
) -> Result<(), String> {
    let job = {
        let c = Composition::load_with(dir, Media::with_budget(WORKER_CACHE))
            .map_err(|e| e.to_string())?;
        let total = c.info().duration_frames;
        let (from, to) = settings.range.unwrap_or((0, total));
        let frames = from.min(total)..to.min(total);
        if frames.is_empty() {
            return Err(format!("no frames to write: {from}..{to} of {total}"));
        }
        Job {
            fps: c.settings().fps.max(1.0),
            frames,
            project: c.size(),
            size: scaled(c.size(), settings.scale),
            plan: c.audio().clone(),
        }
    };
    tell(&|p| {
        p.stage = Stage::Rendering;
        p.total = job.frames.len() as u32;
        p.size = job.size;
    });
    if let Some(out) = settings
        .output
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
    {
        std::fs::create_dir_all(out).map_err(|e| format!("{}: {e}", out.display()))?;
    }
    std::fs::create_dir_all(parts).map_err(|e| format!("{}: {e}", parts.display()))?;

    let least = ((job.fps * LEAST_SHARED).round() as u32).max(1);
    let workers = settings
        .workers
        .clamp(1, job.frames.len().div_ceil(least as usize));
    let lanes = Lanes::new(&job.frames, workers, least);
    let failure = Mutex::new(None::<String>);
    let sound = settings.audio.filter(|_| !job.plan.is_empty());
    let threads = std::thread::available_parallelism().map_or(4, |n| n.get());
    let encoder_threads = if settings.codec.is_hardware() {
        2
    } else {
        (threads * 3 / 2).div_ceil(workers).max(2)
    };

    let fail = |e: String| {
        failure
            .lock()
            .expect("no panics with the lock")
            .get_or_insert(e);
        shared.stop.store(true, Ordering::Relaxed);
    };
    std::thread::scope(|scope| {
        let mut handles = Vec::new();
        if sound.is_some() {
            let (job, fail) = (&job, &fail);
            let path = parts.join("sound.f32");
            handles.push(
                std::thread::Builder::new()
                    .name("framescript-export-sound".into())
                    .spawn_scoped(scope, move || {
                        if let Err(e) = mix(job, &path, shared) {
                            fail(e);
                        }
                    })
                    .expect("a thread can be started"),
            );
        }
        for i in 0..workers {
            let (job, lanes, fail) = (&job, &lanes, &fail);
            handles.push(
                std::thread::Builder::new()
                    .name(format!("framescript-export-{i}"))
                    .spawn_scoped(scope, move || {
                        let worker = Worker {
                            dir,
                            settings,
                            job,
                            parts,
                            shared,
                            encoder_threads,
                        };
                        if let Err(e) = worker.run(lanes, i) {
                            fail(e);
                        }
                    })
                    .expect("a thread can be started"),
            );
        }
        while !handles.iter().all(|h| h.is_finished()) {
            std::thread::sleep(REPORT);
            tell(&|_| {});
        }
    });
    if let Some(e) = failure.into_inner().expect("no panics with the lock") {
        return Err(e);
    }
    if shared.stop.load(Ordering::Relaxed) {
        return Ok(());
    }

    tell(&|p| p.stage = Stage::Joining);
    join(settings, &job, parts, sound)
}

/// The frames each worker has left, which it goes through from the start.
struct Lanes {
    lanes: Mutex<Vec<Range<u32>>>,
    /// Less than twice this is not shared.
    least: u32,
}

impl Lanes {
    /// `frames` in as many stretches as there are workers.
    fn new(frames: &Range<u32>, workers: usize, least: u32) -> Self {
        let len = frames.len() as u64;
        let at = |i: usize| frames.start + (len * i as u64 / workers as u64) as u32;
        Self {
            lanes: Mutex::new((0..workers).map(|i| at(i)..at(i + 1)).collect()),
            least,
        }
    }

    /// The next frame for worker `i`: the next of its own, or else the first of the second half of
    /// what another has most of left.
    fn next(&self, i: usize) -> Option<u32> {
        let mut lanes = self.lanes.lock().expect("no panics with the lock");
        if lanes[i].is_empty() {
            let (j, most) = lanes
                .iter()
                .enumerate()
                .map(|(j, r)| (j, r.len() as u32))
                .max_by_key(|&(_, len)| len)?;
            if most < self.least * 2 {
                return None;
            }
            let half = lanes[j].start + most / 2;
            lanes[i] = half..lanes[j].end;
            lanes[j].end = half;
        }
        lanes[i].next()
    }
}

/// The piece that starts at `frame`: in the order of the frames by name.
fn part(parts: &Path, frame: u32, codec: Codec) -> PathBuf {
    parts.join(format!("part-{frame:010}.{}", codec.extension()))
}

struct Worker<'a> {
    dir: &'a Path,
    settings: &'a ExportSettings,
    job: &'a Job,
    parts: &'a Path,
    shared: &'a Shared,
    encoder_threads: usize,
}

impl Worker<'_> {
    fn run(&self, lanes: &Lanes, i: usize) -> Result<(), String> {
        let media = Media::with_budget(WORKER_CACHE);
        let mut c = Composition::load_with(self.dir, media).map_err(|e| e.to_string())?;
        if c.size() != self.job.project {
            return Err("the project changed while it was being exported".into());
        }
        let mut gpu = OffscreenRenderer::new().map_err(|e| format!("no GPU to draw with: {e}"))?;
        gpu.set_size(Some(self.job.size));
        // The piece being written, and the frame it goes on with.
        let mut piece: Option<(Encoder, u32)> = None;
        while let Some(f) = lanes.next(i) {
            if self.shared.stop.load(Ordering::Relaxed) {
                return Ok(());
            }
            let mut encoder = match piece.take() {
                Some((e, next)) if next == f => e,
                other => {
                    if let Some((e, _)) = other {
                        e.finish()?;
                    }
                    let path = part(self.parts, f, self.settings.codec);
                    Encoder::start(self.part_arguments(&path))?
                }
            };
            let (scene, _) = c.render(f).map_err(|e| format!("frame {f}: {e}"))?;
            let px = if self.settings.codec.takes_yuv420() {
                gpu.yuv420(&scene)
            } else {
                gpu.rgba(&scene)
            };
            encoder.send(px)?;
            self.shared.done.fetch_add(1, Ordering::Relaxed);
            piece = Some((encoder, f + 1));
        }
        match piece {
            Some((e, _)) => e.finish(),
            None => Ok(()),
        }
    }

    fn part_arguments(&self, path: &Path) -> Vec<String> {
        let codec = self.settings.codec;
        let (format, (w, h)) = if codec.takes_yuv420() {
            ("yuv420p", yuv_size(self.job.size.0, self.job.size.1))
        } else {
            ("rgba", self.job.size)
        };
        let (num, den) = rational(self.job.fps);
        let mut args = codec.input_arguments();
        args.extend(
            [
                "-f",
                "rawvideo",
                "-pix_fmt",
                format,
                "-s",
                &format!("{w}x{h}"),
                "-color_range",
                "tv",
                "-colorspace",
                "bt709",
                "-framerate",
                &format!("{num}/{den}"),
                "-i",
                "pipe:0",
            ]
            .map(String::from),
        );
        args.extend(codec.filter());
        args.extend(codec.arguments(self.settings.quality, self.settings.speed));
        args.extend(
            [
                "-colorspace",
                "bt709",
                "-color_primaries",
                "bt709",
                "-color_trc",
                "bt709",
                "-color_range",
                "tv",
                "-threads",
                &self.encoder_threads.to_string(),
                "-video_track_timescale",
                &timescale(num).to_string(),
                "-an",
            ]
            .map(String::from),
        );
        args.push(path.to_string_lossy().into_owned());
        args
    }
}

/// Mixes the sound of the frames into a file of `f32` pairs, a second at a time.
fn mix(job: &Job, path: &Path, shared: &Shared) -> Result<(), String> {
    let pair = |frame: u32| (frame as f64 / job.fps * RATE as f64).round() as i64;
    let (start, end) = (pair(job.frames.start), pair(job.frames.end));
    let file = std::fs::File::create(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut file = std::io::BufWriter::new(file);
    let mut block = vec![0.0f32; RATE as usize * 2];
    let mut bytes = Vec::with_capacity(block.len() * 4);
    let mut at = start;
    while at < end {
        if shared.stop.load(Ordering::Relaxed) {
            return Ok(());
        }
        let n = (RATE as i64).min(end - at) as usize;
        if !job.plan.mix(at, &mut block[..n * 2], SOUND_WAIT) {
            return Err(format!(
                "the sound at {:.1} s didn't decode in time",
                at as f64 / RATE as f64
            ));
        }
        bytes.clear();
        bytes.extend(block[..n * 2].iter().flat_map(|s| s.to_le_bytes()));
        file.write_all(&bytes)
            .map_err(|e| format!("{}: {e}", path.display()))?;
        at += n as i64;
    }
    file.flush().map_err(|e| format!("{}: {e}", path.display()))
}

/// Joins the pieces, as they are, with the sound, into the file asked for.
fn join(
    settings: &ExportSettings,
    job: &Job,
    parts: &Path,
    sound: Option<u32>,
) -> Result<(), String> {
    let list = parts.join("parts.txt");
    let mut pieces: Vec<PathBuf> = std::fs::read_dir(parts)
        .map_err(|e| format!("{}: {e}", parts.display()))?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("part-"))
        })
        .collect();
    pieces.sort();
    let lines: String = pieces
        .iter()
        .map(|p| {
            let p = p.to_string_lossy().replace('\'', r"'\''");
            format!("file '{p}'\n")
        })
        .collect();
    std::fs::write(&list, lines).map_err(|e| format!("{}: {e}", list.display()))?;

    let joined = parts.join(format!("joined.{}", settings.codec.extension()));
    let mut args: Vec<String> = ["-f", "concat", "-safe", "0", "-i"]
        .map(String::from)
        .to_vec();
    args.push(list.to_string_lossy().into_owned());
    if sound.is_some() {
        args.extend(["-f", "f32le", "-ar", &RATE.to_string(), "-ac", "2", "-i"].map(String::from));
        args.push(parts.join("sound.f32").to_string_lossy().into_owned());
    }
    args.extend(["-map", "0:v", "-c:v", "copy"].map(String::from));
    if let Some(kbps) = sound {
        args.extend(["-map", "1:a"].map(String::from));
        args.extend(settings.codec.sound(kbps));
    }
    let (num, _) = rational(job.fps);
    args.extend(
        [
            "-video_track_timescale",
            &timescale(num).to_string(),
            "-movflags",
            "+faststart",
        ]
        .map(String::from),
    );
    args.push(joined.to_string_lossy().into_owned());
    Encoder::start(args)?.finish()?;
    std::fs::rename(&joined, &settings.output)
        .map_err(|e| format!("{}: {e}", settings.output.display()))
}

/// `size` at `scale`, in whole pixels.
fn scaled((w, h): (u32, u32), scale: f64) -> (u32, u32) {
    let side = |n: u32| ((n as f64 * scale).round() as u32).max(1);
    (side(w), side(h))
}

/// The frame rate as a fraction FFmpeg knows: 30000/1001 for 29.97.
fn rational(fps: f64) -> (u32, u32) {
    for (den, near) in [(1u32, 1e-6), (1001, 0.1)] {
        let num = fps * den as f64;
        if (num - num.round()).abs() < near {
            return (num.round() as u32, den);
        }
    }
    ((fps * 1000.0).round() as u32, 1000)
}

/// Ticks a second in the file, for a rate of `num` over something: a multiple of it, so that
/// every frame starts on a tick, and at least 10000 as FFmpeg makes it.
fn timescale(num: u32) -> u32 {
    num * 10_000u32.div_ceil(num.max(1))
}

/// An `ffmpeg` that is given frames, from a thread of its own so that drawing the next frame goes
/// on while one is written.
struct Encoder {
    child: Child,
    frames: Option<SyncSender<Vec<u8>>>,
    writer: Option<JoinHandle<std::io::Result<()>>>,
    errors: Option<JoinHandle<String>>,
}

impl Encoder {
    fn start(args: Vec<String>) -> Result<Encoder, String> {
        let mut child = Command::new(ffmpeg())
            .args(["-hide_banner", "-nostats", "-loglevel", "error", "-y"])
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| no_ffmpeg(&e))?;
        let mut stderr = child.stderr.take().expect("it was piped");
        let errors = std::thread::spawn(move || {
            let mut text = String::new();
            let _ = stderr.read_to_string(&mut text);
            text
        });
        let stdin: ChildStdin = child.stdin.take().expect("it was piped");
        let (frames, queue) = sync_channel::<Vec<u8>>(QUEUE);
        let writer = std::thread::spawn(move || {
            let mut stdin = stdin;
            for frame in queue {
                stdin.write_all(&frame)?;
            }
            Ok(())
        });
        Ok(Encoder {
            child,
            frames: Some(frames),
            writer: Some(writer),
            errors: Some(errors),
        })
    }

    fn send(&mut self, frame: Vec<u8>) -> Result<(), String> {
        let sent = self.frames.as_ref().is_some_and(|f| f.send(frame).is_ok());
        if sent { Ok(()) } else { Err(self.failure()) }
    }

    /// Waits for it to write everything out.
    fn finish(mut self) -> Result<(), String> {
        drop(self.frames.take());
        let written = self.writer.take().map(|w| w.join());
        let status = self.child.wait();
        let errors = self
            .errors
            .take()
            .and_then(|e| e.join().ok())
            .unwrap_or_default();
        match (written, status) {
            (Some(Ok(Ok(()))) | None, Ok(s)) if s.success() => Ok(()),
            _ => Err(failed(&errors)),
        }
    }

    /// Why it stopped taking frames.
    fn failure(&mut self) -> String {
        drop(self.frames.take());
        let _ = self.child.wait();
        let errors = self
            .errors
            .take()
            .and_then(|e| e.join().ok())
            .unwrap_or_default();
        failed(&errors)
    }
}

fn failed(errors: &str) -> String {
    let errors = errors.trim();
    if errors.is_empty() {
        "ffmpeg failed".into()
    } else {
        format!("ffmpeg: {errors}")
    }
}

impl Drop for Encoder {
    fn drop(&mut self) {
        // Not finished: what it wrote is thrown away.
        if self.frames.take().is_some() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        if let Some(w) = self.writer.take() {
            let _ = w.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rates_are_fractions_ffmpeg_knows() {
        assert_eq!(rational(60.0), (60, 1));
        assert_eq!(rational(29.97), (30000, 1001));
        assert_eq!(rational(23.976), (24000, 1001));
        assert_eq!(rational(59.94), (60000, 1001));
        assert_eq!(rational(12.5), (12500, 1000));
        assert_eq!(timescale(60), 10_020);
        assert_eq!(timescale(30000), 30000);
    }

    #[test]
    fn every_frame_goes_to_one_worker() {
        for (frames, workers, least) in [
            (0..1, 1, 60),
            (10..610, 4, 60),
            (0..10_000, 8, 30),
            (5..9, 3, 1),
        ] {
            let lanes = Lanes::new(&frames, workers, least);
            let mut seen = Vec::new();
            // The first worker is quick, the others slow: it takes over what they have left.
            let mut slow = vec![0usize; workers];
            loop {
                let mut any = false;
                for (i, s) in slow.iter_mut().enumerate() {
                    *s += 1;
                    if (i == 0 || *s % 5 == 0)
                        && let Some(f) = lanes.next(i)
                    {
                        seen.push(f);
                        any = true;
                    }
                }
                if !any && (0..workers).all(|i| lanes.lanes.lock().unwrap()[i].is_empty()) {
                    break;
                }
                if !any {
                    // Those left don't share: the slow ones finish them.
                    for i in 0..workers {
                        seen.extend(std::iter::from_fn(|| lanes.next(i)));
                    }
                }
            }
            seen.sort();
            assert_eq!(seen, frames.clone().collect::<Vec<_>>(), "{frames:?}");
        }
    }
}
