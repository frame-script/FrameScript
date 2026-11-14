//! Pictures and videos in a composition.
//!
//! Pictures are AntiWebUI's own `img`: decoded on its workers at the size they show at, and kept.
//!
//! Videos are decoded here, not by AntiWebUI's player, which keeps time by the clock: a frame of a
//! composition has to show the same picture however it was reached. Each video has a thread that
//! decodes ([`VideoReader`]) into a cache of frames, around the time last asked for:
//!
//! - what is asked for and the half second after it are decoded first, so playing goes on from
//!   frames that are there already (for each node that shows the video, if there are several);
//! - going a little forward reads on, going back or far goes to the key frame before, and every
//!   frame decoded on the way is kept: scrubbing back over them costs nothing;
//! - when there is too much, what is furthest from where the playhead is goes first;
//! - the cache stays when the project is loaded again, as long as the file doesn't change.
//!
//! The preview doesn't wait long for a frame that isn't there: it shows the closest one there is,
//! and is told when the right one comes (see [`Media::set_listener`]). What has to be exact, like a
//! render, waits.

use anti_webui_core::tree::{Document, NodeId, NodeKind};
use anti_webui_core::video::{VideoFrame, VideoPixels, VideoSettings, next_video_id, show_frame};
use crate::sound::AudioSource;
use anti_webui_style::ImageSource;
use anti_webui_video::{DecodedFrame, VideoInfo, VideoReader};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime};

/// How much of what comes after the time asked for is decoded ahead.
const AHEAD: f64 = 0.5;
/// How far ahead the decoder reads on rather than going to a key frame.
const READ_ON: f64 = 2.0;
/// Times this close are the same: what is asked for is a frame of the project in seconds, which
/// needn't come out exactly at the start of a frame of the video.
const EPSILON: f64 = 1e-5;
/// What the frames of all videos may take, unless `FRAMESCRIPT_VIDEO_CACHE_MB` says.
const BUDGET: usize = 1 << 30;

type Listener = Arc<dyn Fn() + Send + Sync>;

/// What the videos share.
struct Common {
    listener: Mutex<Option<Listener>>,
    sources: AtomicUsize,
    budget: usize,
}

impl Common {
    fn tell(&self) {
        let listener = self.listener.lock().expect("no panics with the lock").clone();
        if let Some(listener) = listener {
            listener();
        }
    }
}

/// The videos that have been opened, and their frames. It outlives the compositions that use it,
/// so that loading a project again keeps what has been decoded.
#[derive(Clone)]
pub struct Media {
    videos: Arc<Mutex<HashMap<PathBuf, Opened>>>,
    sounds: Arc<Mutex<HashMap<PathBuf, OpenedSound>>>,
    common: Arc<Common>,
}

/// When the file was changed and how big it is: when that changes, it is opened again.
type FileStamp = (Option<SystemTime>, u64);
type Opened = (FileStamp, Arc<VideoSource>);
type OpenedSound = (FileStamp, Arc<AudioSource>);

impl Default for Media {
    fn default() -> Self {
        let budget = std::env::var("FRAMESCRIPT_VIDEO_CACHE_MB")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .map_or(BUDGET, |mb| mb << 20);
        Self {
            videos: Arc::default(),
            sounds: Arc::default(),
            common: Arc::new(Common {
                listener: Mutex::new(None),
                sources: AtomicUsize::new(0),
                budget,
            }),
        }
    }
}

impl Media {
    pub fn new() -> Self {
        Self::default()
    }

    /// `f` is called, from a decoder's thread, when a frame comes that was shown something else
    /// in place of.
    pub fn set_listener(&self, f: impl Fn() + Send + Sync + 'static) {
        *self.common.listener.lock().expect("no panics with the lock") = Some(Arc::new(f));
    }

    /// The video in the file at `path`, opened once for as long as the file stays the same.
    pub fn video(&self, path: &Path) -> Result<Arc<VideoSource>, String> {
        let stamp = stamp_of(path)?;
        let mut videos = self.videos.lock().expect("no panics with the lock");
        if let Some((known, source)) = videos.get(path)
            && *known == stamp
        {
            return Ok(source.clone());
        }
        let source = Arc::new(VideoSource::open(path, self.common.clone())?);
        videos.insert(path.to_path_buf(), (stamp, source.clone()));
        Ok(source)
    }

    /// The sound in the file at `path`, opened once for as long as the file stays the same.
    pub fn audio(&self, path: &Path) -> Result<Arc<AudioSource>, String> {
        let stamp = stamp_of(path)?;
        let mut sounds = self.sounds.lock().expect("no panics with the lock");
        if let Some((known, source)) = sounds.get(path)
            && *known == stamp
        {
            return Ok(source.clone());
        }
        let source = Arc::new(AudioSource::open(path)?);
        sounds.insert(path.to_path_buf(), (stamp, source.clone()));
        Ok(source)
    }

    /// Lets go of the videos and sounds nothing uses: after a project was loaded again, those it
    /// no longer has.
    pub fn collect(&self) {
        self.videos
            .lock()
            .expect("no panics with the lock")
            .retain(|_, (_, source)| Arc::strong_count(source) > 1);
        self.sounds
            .lock()
            .expect("no panics with the lock")
            .retain(|_, (_, source)| Arc::strong_count(source) > 1);
    }
}

fn stamp_of(path: &Path) -> Result<FileStamp, String> {
    std::fs::metadata(path)
        .map(|m| (m.modified().ok(), m.len()))
        .map_err(|e| format!("{}: {e}", path.display()))
}

/// What a video has to show for a time.
#[derive(Clone, Debug)]
pub enum Lookup {
    /// The frame that shows then.
    Exact(Arc<VideoFrame>),
    /// The closest there is, if any, while the right one is decoded.
    StandIn(Option<Arc<VideoFrame>>),
}

struct Cached {
    start: f64,
    /// When the next frame starts: from its duration until the next one is decoded after it.
    end: f64,
    frame: Arc<VideoFrame>,
    bytes: usize,
}

#[derive(Default)]
struct SourceState {
    /// By when they start, in microseconds. The first frame of the video is also under
    /// `i64::MIN`, so that it is what shows before it starts.
    frames: BTreeMap<i64, Cached>,
    bytes: usize,
    /// The time last asked for, by what asked.
    wanted: BTreeMap<u64, f64>,
    /// What was shown something else for what it wanted, and is to hear when that is here.
    waiting: HashSet<u64>,
    error: Option<String>,
    quit: bool,
}

struct SourceShared {
    state: Mutex<SourceState>,
    changed: Condvar,
    common: Arc<Common>,
}

impl SourceShared {
    fn lock(&self) -> MutexGuard<'_, SourceState> {
        self.state.lock().expect("no panics with the lock")
    }
}

/// A video and the frames decoded of it.
pub struct VideoSource {
    path: PathBuf,
    info: VideoInfo,
    shared: Arc<SourceShared>,
    thread: Option<JoinHandle<()>>,
}

impl VideoSource {
    fn open(path: &Path, common: Arc<Common>) -> Result<Self, String> {
        let source = path.to_str().ok_or_else(|| format!("{} is not UTF-8", path.display()))?;
        // The GPU decodes when it is said where: `FRAMESCRIPT_HWDEC=/dev/dri/renderD128`.
        let device = std::env::var_os("FRAMESCRIPT_HWDEC")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from);
        let reader = VideoReader::open(source, &VideoSettings::default(), device.as_deref())
            .map_err(|e| e.to_string())?;
        let info = reader.info();
        let shared = Arc::new(SourceShared {
            state: Mutex::new(SourceState::default()),
            changed: Condvar::new(),
            common,
        });
        shared.common.sources.fetch_add(1, Ordering::Relaxed);
        let thread = std::thread::Builder::new()
            .name("framescript-video".into())
            .spawn({
                let shared = shared.clone();
                move || Decoder::new(shared, reader).run()
            })
            .expect("a thread can be started");
        Ok(Self {
            path: path.to_path_buf(),
            info,
            shared,
            thread: Some(thread),
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn info(&self) -> VideoInfo {
        self.info
    }

    /// The frame that shows `seconds` into the video, for `asker` (anything that tells what asks
    /// apart), waiting up to `wait` for it to be decoded.
    pub fn frame_at(&self, asker: u64, seconds: f64, wait: Duration) -> Lookup {
        let deadline = Instant::now() + wait;
        let mut state = self.want_locked(asker, seconds);
        loop {
            if let Some(c) = covering(&state.frames, seconds) {
                return Lookup::Exact(c.frame.clone());
            }
            let now = Instant::now();
            if state.error.is_some() || now >= deadline {
                if state.error.is_none() {
                    state.waiting.insert(asker);
                }
                return Lookup::StandIn(nearest(&state.frames, seconds));
            }
            state = self
                .shared
                .changed
                .wait_timeout(state, deadline - now)
                .expect("no panics with the lock")
                .0;
        }
    }

    /// Starts decoding what shows at `seconds`, for something that is about to show.
    pub fn want(&self, asker: u64, seconds: f64) {
        drop(self.want_locked(asker, seconds));
    }

    /// `asker` doesn't want anything of it any more.
    pub fn unwant(&self, asker: u64) {
        let mut state = self.shared.lock();
        state.wanted.remove(&asker);
        state.waiting.remove(&asker);
    }

    /// Why it can't be decoded, if it can't.
    pub fn error(&self) -> Option<String> {
        self.shared.lock().error.clone()
    }

    /// How many frames are kept, and how many bytes they take.
    pub fn cached(&self) -> (usize, usize) {
        let state = self.shared.lock();
        (state.frames.len(), state.bytes)
    }

    fn want_locked(&self, asker: u64, seconds: f64) -> MutexGuard<'_, SourceState> {
        let mut state = self.shared.lock();
        if state.wanted.insert(asker, seconds) != Some(seconds) {
            state.waiting.remove(&asker);
            self.shared.changed.notify_all();
        }
        state
    }
}

impl Drop for VideoSource {
    fn drop(&mut self) {
        self.shared.lock().quit = true;
        self.shared.changed.notify_all();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        self.shared.common.sources.fetch_sub(1, Ordering::Relaxed);
    }
}

fn key(seconds: f64) -> i64 {
    (seconds * 1e6).round() as i64
}

/// The frame that shows at `seconds`, if it has been decoded.
fn covering(frames: &BTreeMap<i64, Cached>, seconds: f64) -> Option<&Cached> {
    let (_, c) = frames.range(..=key(seconds + EPSILON)).next_back()?;
    (seconds + EPSILON < c.end).then_some(c)
}

/// What is closest to `seconds`: the last frame before it, or else the first after it.
fn nearest(frames: &BTreeMap<i64, Cached>, seconds: f64) -> Option<Arc<VideoFrame>> {
    let k = key(seconds + EPSILON);
    frames
        .range(..=k)
        .next_back()
        .or_else(|| frames.range(k..).next())
        .map(|(_, c)| c.frame.clone())
}

/// The first time that no frame there is covers in the window after what is wanted, and that.
fn first_missing(state: &SourceState, duration: Option<f64>) -> Option<(f64, f64)> {
    state
        .wanted
        .values()
        .find_map(|&w| missing_after(state, w, duration).map(|m| (w, m)))
}

/// How far the closest of what is wanted is from `seconds`.
fn distance(wanted: &BTreeMap<u64, f64>, seconds: f64) -> f64 {
    wanted
        .values()
        .map(|w| (w - seconds).abs())
        .fold(f64::INFINITY, f64::min)
}

/// The first time in the window after `wanted` that no frame there is covers.
fn missing_after(state: &SourceState, wanted: f64, duration: Option<f64>) -> Option<f64> {
    let mut end = wanted + AHEAD;
    if let Some(d) = duration {
        end = end.min(d.max(wanted));
    }
    let mut t = wanted;
    loop {
        match covering(&state.frames, t) {
            Some(c) if c.end >= end || c.end.is_infinite() => return None,
            Some(c) => t = c.end,
            None => return Some(t),
        }
    }
}

fn bytes_of(frame: &VideoFrame) -> usize {
    match &frame.pixels {
        VideoPixels::Memory(planes) => planes
            .iter()
            .map(|p| p.stride as usize * p.size.1 as usize)
            .sum(),
        #[cfg(unix)]
        VideoPixels::Dmabuf(_) => 0,
    }
}

/// Where the decoder is in the video.
struct Run {
    /// The time it went to the key frame for: from where it is up to this, reading on is never
    /// slower than going there again.
    target: f64,
    /// When the last frame it decoded starts.
    position: f64,
    /// The key of the last frame it decoded, to tell it where it ends when the next one comes.
    last: Option<i64>,
    ended: bool,
}

struct Decoder {
    shared: Arc<SourceShared>,
    reader: VideoReader,
    duration: Option<f64>,
    run: Option<Run>,
}

impl Decoder {
    fn new(shared: Arc<SourceShared>, reader: VideoReader) -> Self {
        let duration = reader.info().duration;
        Self {
            shared,
            reader,
            duration,
            run: None,
        }
    }

    fn run(mut self) {
        while let Some(missing) = self.next_missing() {
            if let Err(e) = self.step(missing) {
                self.shared.lock().error = Some(e);
                self.shared.changed.notify_all();
                continue;
            }
            self.trim();
        }
    }

    /// Waits for something to decode. `None` when it's time to stop.
    fn next_missing(&self) -> Option<f64> {
        let mut state = self.shared.lock();
        loop {
            if state.quit {
                return None;
            }
            if state.error.is_none()
                && let Some((_, missing)) = first_missing(&state, self.duration)
            {
                return Some(missing);
            }
            state = self.shared.changed.wait(state).expect("no panics with the lock");
        }
    }

    /// Decodes one frame on the way to `missing`.
    fn step(&mut self, missing: f64) -> Result<(), String> {
        let reads_on = self.run.as_ref().is_some_and(|r| {
            !r.ended
                && r.position <= missing + EPSILON
                && missing <= r.target.max(r.position + READ_ON)
        });
        if !reads_on {
            return self.go_to(missing);
        }
        match self.reader.next_frame().map_err(|e| e.to_string())? {
            Some(frame) => self.keep(frame, false),
            None => self.end(),
        }
        Ok(())
    }

    /// Goes to the key frame before `target` and decodes the first frame there. Some files only
    /// know roughly where their key frames are: if that came out after it, from further back.
    fn go_to(&mut self, target: f64) -> Result<(), String> {
        let mut from = target;
        let mut back = 1.0;
        loop {
            self.reader.seek(from).map_err(|e| e.to_string())?;
            self.run = Some(Run {
                target,
                position: from,
                last: None,
                ended: false,
            });
            let Some(frame) = self.reader.next_frame().map_err(|e| e.to_string())? else {
                if from <= 0.0 {
                    return Err("there are no pictures in it".into());
                }
                from = (from - back).max(0.0);
                back *= 2.0;
                continue;
            };
            if frame.start > target + EPSILON && from > 0.0 {
                from = (from - back).max(0.0);
                back *= 2.0;
                continue;
            }
            self.keep(frame, from <= 0.0);
            return Ok(());
        }
    }

    /// Keeps a frame just decoded. The `first` of the video is also what shows before it starts.
    fn keep(&mut self, decoded: DecodedFrame, first: bool) {
        let run = self.run.as_mut().expect("there is a run");
        let start = decoded.start;
        let k = key(start);
        let end = start + decoded.duration.unwrap_or(1.0 / 30.0);
        let cached = |bytes| Cached {
            start,
            end,
            frame: decoded.frame.clone(),
            bytes,
        };
        let mut state = self.shared.lock();
        if let Some(last) = run.last.replace(k)
            && let Some(c) = state.frames.get_mut(&last)
        {
            c.end = start;
        }
        if first {
            // The same pixels: they only count once.
            state.frames.insert(i64::MIN, cached(0));
        }
        let bytes = bytes_of(&decoded.frame);
        state.bytes += bytes;
        if let Some(old) = state.frames.insert(k, cached(bytes)) {
            state.bytes -= old.bytes;
        }
        run.position = start;
        self.arrived(state);
    }

    /// The last frame shows to the end.
    fn end(&mut self) {
        let run = self.run.as_mut().expect("there is a run");
        run.ended = true;
        let mut state = self.shared.lock();
        if let Some(last) = run.last
            && let Some(c) = state.frames.get_mut(&last)
        {
            c.end = f64::INFINITY;
        }
        self.arrived(state);
    }

    /// Wakes what waits for frames, and tells the listener if what it was waiting for is here.
    fn arrived(&self, mut state: MutexGuard<'_, SourceState>) {
        let before = state.waiting.len();
        let SourceState {
            frames,
            wanted,
            waiting,
            ..
        } = &mut *state;
        waiting.retain(|asker| {
            wanted
                .get(asker)
                .is_some_and(|&w| covering(frames, w).is_none())
        });
        let tell = waiting.len() < before;
        drop(state);
        self.shared.changed.notify_all();
        if tell {
            self.shared.common.tell();
        }
    }

    /// Lets go of what is furthest from what is wanted while there is too much, but not of the
    /// windows around that.
    fn trim(&self) {
        let common = &self.shared.common;
        let budget = common.budget / common.sources.load(Ordering::Relaxed).max(1);
        let mut state = self.shared.lock();
        while state.bytes > budget {
            let first = state.frames.iter().next().map(|(k, c)| (*k, c.start));
            let last = state.frames.iter().next_back().map(|(k, c)| (*k, c.start));
            let (Some(first), Some(last)) = (first, last) else {
                break;
            };
            let (to_first, to_last) = (
                distance(&state.wanted, first.1),
                distance(&state.wanted, last.1),
            );
            let (far, how_far) = if to_first > to_last {
                (first, to_first)
            } else {
                (last, to_last)
            };
            if how_far <= AHEAD {
                break;
            }
            if let Some(c) = state.frames.remove(&far.0) {
                state.bytes -= c.bytes;
            }
        }
    }
}

/// The pictures and videos of one composition, by the handles of their nodes.
pub struct MediaNodes {
    media: Media,
    dir: PathBuf,
    videos: HashMap<u32, VideoNode>,
}

impl Drop for VideoNode {
    fn drop(&mut self) {
        if let Some(source) = &self.source {
            source.unwant(self.stream);
        }
    }
}

struct VideoNode {
    id: NodeId,
    source: Option<Arc<VideoSource>>,
    /// Seconds into the video, or NaN for none.
    time: f64,
    /// Whether it shows now, rather than being about to.
    shown: bool,
    /// The frame of the source it shows.
    showing: Option<u64>,
    /// What it is to the renderer, which keeps one picture per stream.
    stream: u64,
    alive: Arc<()>,
}

impl MediaNodes {
    pub fn new(media: Media, dir: PathBuf) -> Self {
        Self {
            media,
            dir,
            videos: HashMap::new(),
        }
    }

    pub fn media(&self) -> &Media {
        &self.media
    }

    /// Where a path of the project is: relative to its directory.
    pub fn resolve(&self, src: &str) -> PathBuf {
        let path = Path::new(src);
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.dir.join(path)
        }
    }

    /// The video in `src`, for what the scripts ask about it.
    pub fn video(&self, src: &str) -> Result<Arc<VideoSource>, String> {
        self.media.video(&self.resolve(src))
    }

    /// The sound in `src`, for what the scripts ask about it.
    pub fn audio(&self, src: &str) -> Result<Arc<AudioSource>, String> {
        self.media.audio(&self.resolve(src))
    }

    /// The node `handle` (`id` in `doc`) is to show `src`: a picture or a video, by what it is.
    pub fn set_source(&mut self, doc: &mut Document, handle: u32, id: NodeId, src: &str) {
        let path = self.resolve(src);
        match doc.get(id).map(|n| &n.kind) {
            Some(NodeKind::Image(_)) => {
                doc.set_image_source(id, ImageSource::Path(Arc::from(path.as_path())));
            }
            Some(NodeKind::Video(_)) => {
                let source = match self.media.video(&path) {
                    Ok(source) => Some(source),
                    Err(e) => {
                        eprintln!("framescript: can't open the video {src}: {e}");
                        None
                    }
                };
                let node = self.videos.entry(handle).or_insert_with(|| VideoNode {
                    id,
                    source: None,
                    time: f64::NAN,
                    shown: false,
                    showing: None,
                    stream: next_video_id(),
                    alive: Arc::new(()),
                });
                if let Some(old) = &node.source {
                    old.unwant(node.stream);
                }
                node.source = source;
                node.showing = None;
                show_frame(doc, id, None);
            }
            _ => {}
        }
    }

    /// The video of `handle` is to show `seconds` into it (NaN: nothing), or is about to.
    pub fn set_time(&mut self, handle: u32, seconds: f64, shown: bool) {
        if let Some(node) = self.videos.get_mut(&handle) {
            node.time = seconds;
            node.shown = shown;
        }
    }

    pub fn forget(&mut self, handle: u32) {
        self.videos.remove(&handle);
    }

    /// Puts in each video that shows the frame of its time, waiting up to `wait` in all. Returns
    /// whether all of them are the right ones.
    pub fn show_frames(&mut self, doc: &mut Document, wait: Duration) -> bool {
        // Everything is asked for first, so that the videos decode at the same time.
        for node in self.videos.values_mut() {
            let Some(source) = &node.source else {
                continue;
            };
            if node.time.is_finite() {
                source.want(node.stream, node.time);
            } else {
                source.unwant(node.stream);
                if node.showing.take().is_some() {
                    show_frame(doc, node.id, None);
                }
            }
        }
        let deadline = Instant::now() + wait;
        let mut complete = true;
        for node in self.videos.values_mut() {
            let Some(source) = &node.source else {
                continue;
            };
            if !node.time.is_finite() || !node.shown {
                continue;
            }
            let left = deadline.saturating_duration_since(Instant::now());
            let frame = match source.frame_at(node.stream, node.time, left) {
                Lookup::Exact(frame) => Some(frame),
                Lookup::StandIn(frame) => {
                    complete &= source.error().is_some();
                    frame
                }
            };
            let Some(frame) = frame else {
                continue;
            };
            if node.showing != Some(frame.id) {
                node.showing = Some(frame.id);
                let frame = frame.restream(node.stream, Arc::downgrade(&node.alive));
                show_frame(doc, node.id, Some(frame));
            }
        }
        complete
    }
}
