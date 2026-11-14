//! The sound of a composition: what plays when, and the samples of it.
//!
//! Sound isn't made by running the scripts frame by frame. When a project loads, the scripts say
//! once where each piece of sound is (`__fs_audio`): which file, from where in it, when on the
//! timeline, how fast and how loud. That is an [`AudioPlan`], and any stretch of the project's
//! sound is mixed from it, by the preview as it plays or by a render, without the scripts.
//!
//! Each file has a thread that decodes ([`AudioReader`]) into blocks of half a second at
//! [`RATE`], around where it was last asked for and the few seconds after: playing goes on from
//! blocks that are there already, and going back to what was heard costs nothing.

use crate::media::Media;
use anti_webui_core::video::VideoSettings;
use anti_webui_video::{AudioChunk, AudioInfo, AudioReader};
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// Samples a second of everything mixed, in pairs (left, right).
pub const RATE: u32 = 48_000;
/// Pairs in a block.
const BLOCK: i64 = RATE as i64 / 2;
/// How many blocks after the one asked for are decoded ahead.
const AHEAD: i64 = 6;
/// How far ahead the decoder reads on rather than going there, in pairs.
const READ_ON: i64 = 2 * RATE as i64;
/// How far before a block the decoder goes, for the decoder to settle.
const PREROLL: f64 = 0.1;
/// What the blocks of one file may take: about six minutes of it.
const BUDGET: usize = 64 << 20;

/// The pair at `seconds`.
fn pair(seconds: f64) -> i64 {
    (seconds * RATE as f64).round() as i64
}

#[derive(Default)]
struct State {
    blocks: BTreeMap<i64, Arc<[f32]>>,
    /// The block each asker last asked for.
    wanted: HashMap<u64, i64>,
    /// How many pairs there are, once the decoder came to the end.
    end: Option<i64>,
    error: Option<String>,
    quit: bool,
}

struct Shared {
    state: Mutex<State>,
    /// The decoder has something to do.
    work: Condvar,
    /// A block came.
    arrived: Condvar,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().expect("no panics with the lock")
    }
}

/// The sound of a file, decoded on a thread of its own.
pub struct AudioSource {
    path: PathBuf,
    info: AudioInfo,
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
}

impl AudioSource {
    pub fn open(path: &Path) -> Result<Self, String> {
        let reader = AudioReader::open(&path.to_string_lossy(), &VideoSettings::default(), RATE)
            .map_err(|e| e.to_string())?;
        let info = reader.info();
        let shared = Arc::new(Shared {
            state: Mutex::new(State::default()),
            work: Condvar::new(),
            arrived: Condvar::new(),
        });
        let thread = std::thread::Builder::new()
            .name("framescript-audio".into())
            .spawn({
                let shared = shared.clone();
                move || {
                    Decoder {
                        reader,
                        shared,
                        run: None,
                    }
                    .run()
                }
            })
            .map_err(|e| e.to_string())?;
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

    pub fn info(&self) -> AudioInfo {
        self.info
    }

    pub fn error(&self) -> Option<String> {
        self.shared.lock().error.clone()
    }

    /// Fills `out` with the pairs from `from` on, as `asker` (which says where it is, so that
    /// what follows is decoded ahead). Waits up to `wait` for what isn't decoded yet, and leaves
    /// silence for what still isn't. Returns whether everything was there.
    pub fn read(&self, asker: u64, from: i64, out: &mut [f32], wait: Duration) -> bool {
        let deadline = Instant::now() + wait;
        let mut state = self.shared.lock();
        let block = from.div_euclid(BLOCK).max(0);
        if state.wanted.insert(asker, block) != Some(block) {
            self.shared.work.notify_one();
        }
        let pairs = out.len() as i64 / 2;
        let mut complete = true;
        let mut at = from;
        while at < from + pairs {
            let b = at.div_euclid(BLOCK);
            let upto = ((b + 1) * BLOCK).min(from + pairs);
            let range = (at - from) as usize * 2..(upto - from) as usize * 2;
            let silent = b < 0 || state.end.is_some_and(|end| at >= end);
            if silent || state.error.is_some() {
                out[range].fill(0.0);
            } else {
                loop {
                    if let Some(samples) = state.blocks.get(&b) {
                        let offset = (at - b * BLOCK) as usize * 2;
                        let len = range.len();
                        out[range].copy_from_slice(&samples[offset..offset + len]);
                        break;
                    }
                    let left = deadline.saturating_duration_since(Instant::now());
                    if left.is_zero() || state.error.is_some() || state.end.is_some_and(|end| at >= end) {
                        complete &= state.error.is_some() || state.end.is_some_and(|end| at >= end);
                        out[range].fill(0.0);
                        break;
                    }
                    state = self
                        .shared
                        .arrived
                        .wait_timeout(state, left)
                        .expect("no panics with the lock")
                        .0;
                }
            }
            at = upto;
        }
        complete
    }

    /// `asker` no longer needs anything decoded for it.
    pub fn unwant(&self, asker: u64) {
        self.shared.lock().wanted.remove(&asker);
    }
}

impl Drop for AudioSource {
    fn drop(&mut self) {
        self.shared.lock().quit = true;
        self.shared.work.notify_all();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// What the decoder has read and not yet put in a block: pairs that follow on from `from`.
struct Run {
    from: i64,
    pending: Vec<f32>,
    ended: bool,
}

impl Run {
    fn cursor(&self) -> i64 {
        self.from + self.pending.len() as i64 / 2
    }
}

struct Decoder {
    reader: AudioReader,
    shared: Arc<Shared>,
    run: Option<Run>,
}

impl Decoder {
    fn run(mut self) {
        loop {
            let block = {
                let mut state = self.shared.lock();
                loop {
                    if state.quit {
                        return;
                    }
                    if state.error.is_none()
                        && let Some(b) = next_missing(&state)
                    {
                        break b;
                    }
                    state = self.shared.work.wait(state).expect("no panics with the lock");
                }
            };
            match self.block(block) {
                Ok(samples) => {
                    let mut state = self.shared.lock();
                    if let Some(run) = &self.run
                        && run.ended
                        && run.cursor() < (block + 1) * BLOCK
                    {
                        state.end = Some(run.cursor().max(block * BLOCK));
                    }
                    state.blocks.insert(block, samples);
                    trim(&mut state);
                }
                Err(e) => self.shared.lock().error = Some(e),
            }
            self.shared.arrived.notify_all();
        }
    }

    /// Decodes the block `b`: reads on to it when it is a little ahead, and otherwise goes there.
    fn block(&mut self, b: i64) -> Result<Arc<[f32]>, String> {
        let (start, end) = (b * BLOCK, (b + 1) * BLOCK);
        let reads_on = self
            .run
            .as_ref()
            .is_some_and(|r| r.from <= start && start - r.cursor() < READ_ON);
        if !reads_on {
            self.go_to(start)?;
        }
        let mut out = vec![0.0f32; BLOCK as usize * 2];
        loop {
            let run = self.run.as_mut().expect("there is one after going");
            // What of it falls in the block.
            let (lo, hi) = (run.from.max(start), run.cursor().min(end));
            if lo < hi {
                let src = (lo - run.from) as usize * 2..(hi - run.from) as usize * 2;
                let dst = (lo - start) as usize * 2..(hi - start) as usize * 2;
                out[dst].copy_from_slice(&run.pending[src]);
            }
            if run.cursor() >= end {
                // What comes after stays for the next block.
                let keep = (end - run.from).max(0) as usize * 2;
                run.pending.drain(..keep.min(run.pending.len()));
                run.from = run.from.max(end);
                break;
            }
            if run.ended {
                break;
            }
            match self.reader.next_chunk().map_err(|e| e.to_string())? {
                Some(chunk) => self.follow(chunk),
                None => self.run.as_mut().expect("there is one").ended = true,
            }
        }
        Ok(out.into())
    }

    /// Takes what was read next. It replaces what is pending, which has been put in a block.
    fn follow(&mut self, chunk: AudioChunk) {
        let run = self.run.as_mut().expect("there is one");
        run.from = pair(chunk.start);
        run.pending = chunk.samples;
    }

    /// Goes to somewhere at or before `target`, further back as long as the file comes down after
    /// it.
    fn go_to(&mut self, target: i64) -> Result<(), String> {
        let mut back = PREROLL;
        loop {
            let at = (target as f64 / RATE as f64 - back).max(0.0);
            self.reader.seek(at).map_err(|e| e.to_string())?;
            let chunk = self.reader.next_chunk().map_err(|e| e.to_string())?;
            let good = match &chunk {
                Some(c) => pair(c.start) <= target,
                None => false,
            };
            if good || at <= 0.0 || back > 60.0 {
                self.run = Some(match chunk {
                    Some(c) => Run {
                        from: pair(c.start),
                        pending: c.samples,
                        ended: false,
                    },
                    None => Run {
                        from: target,
                        pending: Vec::new(),
                        ended: true,
                    },
                });
                return Ok(());
            }
            back *= 2.0;
        }
    }
}

/// The first block that is wanted and not there: for each asker, from where it is on.
fn next_missing(state: &State) -> Option<i64> {
    let last = state.end.map(|end| (end - 1).div_euclid(BLOCK));
    let mut wanted: Vec<i64> = state.wanted.values().copied().collect();
    wanted.sort_unstable();
    for ahead in 0..=AHEAD {
        for &w in &wanted {
            let b = w + ahead;
            if last.is_some_and(|last| b > last) {
                continue;
            }
            if !state.blocks.contains_key(&b) {
                return Some(b);
            }
        }
    }
    None
}

/// Lets go of the blocks furthest from what is wanted, down to the budget.
fn trim(state: &mut State) {
    let size = BLOCK as usize * 2 * size_of::<f32>();
    while state.blocks.len() * size > BUDGET {
        let distance = |b: i64| {
            state
                .wanted
                .values()
                .map(|&w| if b >= w && b <= w + AHEAD { -1 } else { (b - w).abs() })
                .min()
                .unwrap_or(0)
        };
        let (first, last) = (
            *state.blocks.keys().next().expect("over the budget"),
            *state.blocks.keys().next_back().expect("over the budget"),
        );
        let far = if distance(first) >= distance(last) { first } else { last };
        if distance(far) < 0 {
            break;
        }
        state.blocks.remove(&far);
    }
}

/// A piece of sound as the scripts say it is (see `packages/framescript/audio.ts`).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioClip {
    pub src: String,
    /// When it starts and ends on the timeline, in seconds.
    pub start: f64,
    pub end: f64,
    /// Seconds into the file at `start`.
    pub from: f64,
    /// How fast it goes: 2 is twice as fast (and an octave up).
    pub rate: f64,
    pub volume: f32,
    /// The volume at each frame of the project from `start`, for one that changes, in place of
    /// `volume`. Between frames it goes in a straight line.
    pub envelope: Option<Vec<f32>>,
    /// Seconds it takes to come up from silence at the start, and to go down to it at the end.
    pub fade_in: f64,
    pub fade_out: f64,
}

struct Placed {
    clip: AudioClip,
    source: Arc<AudioSource>,
    /// What it is to its source, which decodes ahead of each.
    asker: u64,
}

static NEXT_ASKER: AtomicU64 = AtomicU64::new(1);

/// What plays when in a composition, and how loud.
pub struct AudioPlan {
    fps: f64,
    /// How long the project is, in seconds.
    duration: f64,
    clips: Vec<Placed>,
}

impl Drop for AudioPlan {
    fn drop(&mut self) {
        for p in &self.clips {
            p.source.unwant(p.asker);
        }
    }
}

impl AudioPlan {
    /// The plan for `clips`, with their files from `media` (`resolve` says where the paths of
    /// the project are). What can't be opened is left out, with a warning.
    pub fn new(
        clips: Vec<AudioClip>,
        fps: f64,
        duration: f64,
        media: &Media,
        resolve: impl Fn(&str) -> PathBuf,
    ) -> Self {
        let clips = clips
            .into_iter()
            .filter(|c| c.end > c.start && c.rate > 0.0)
            .filter_map(|clip| match media.audio(&resolve(&clip.src)) {
                Ok(source) => Some(Placed {
                    clip,
                    source,
                    asker: NEXT_ASKER.fetch_add(1, Ordering::Relaxed),
                }),
                Err(e) => {
                    eprintln!("framescript: can't open the sound of {}: {e}", clip.src);
                    None
                }
            })
            .collect();
        Self {
            fps: fps.max(1.0),
            duration,
            clips,
        }
    }

    pub fn empty() -> Self {
        Self {
            fps: 60.0,
            duration: 0.0,
            clips: Vec::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.clips.is_empty()
    }

    /// How long the project is, in seconds.
    pub fn duration(&self) -> f64 {
        self.duration
    }

    pub fn clips(&self) -> impl Iterator<Item = &AudioClip> {
        self.clips.iter().map(|p| &p.clip)
    }

    /// Mixes the pairs from `at` on (in pairs from the start of the project) into `out`, waiting
    /// up to `wait` in all for what isn't decoded. Returns whether everything was there.
    pub fn mix(&self, at: i64, out: &mut [f32], wait: Duration) -> bool {
        out.fill(0.0);
        let deadline = Instant::now() + wait;
        let pairs = out.len() as i64 / 2;
        let mut complete = true;
        let mut samples = Vec::new();
        for p in &self.clips {
            let c = &p.clip;
            let (start, end) = (pair(c.start), pair(c.end));
            let (lo, hi) = (at.max(start), (at + pairs).min(end));
            if lo >= hi {
                continue;
            }
            let left = deadline.saturating_duration_since(Instant::now());
            let n = (hi - lo) as usize;
            // Where in the file the pair `t` of the timeline is, in pairs of the file.
            let position = |t: i64| c.from * RATE as f64 + (t - start) as f64 * c.rate;
            let gain = |t: i64| self.gain(c, (t - start) as f64 / RATE as f64);
            let dst = (lo - at) as usize * 2;
            if c.rate == 1.0 {
                let first = position(lo).round() as i64;
                samples.resize(n * 2, 0.0);
                complete &= p.source.read(p.asker, first, &mut samples, left);
                for i in 0..n {
                    let g = gain(lo + i as i64);
                    out[dst + i * 2] += samples[i * 2] * g;
                    out[dst + i * 2 + 1] += samples[i * 2 + 1] * g;
                }
            } else {
                // Faster or slower, in between the samples there are.
                let first = position(lo).floor() as i64;
                let last = position(hi - 1).floor() as i64 + 1;
                samples.resize((last - first + 1) as usize * 2, 0.0);
                complete &= p.source.read(p.asker, first, &mut samples, left);
                for i in 0..n {
                    let t = lo + i as i64;
                    let x = position(t) - first as f64;
                    let j = (x.floor() as usize).min((last - first) as usize - 1);
                    let f = (x - j as f64) as f32;
                    let g = gain(t);
                    for ch in 0..2 {
                        let a = samples[j * 2 + ch];
                        let b = samples[(j + 1) * 2 + ch];
                        out[dst + i * 2 + ch] += (a + (b - a) * f) * g;
                    }
                }
            }
        }
        complete
    }

    /// How loud `clip` is `seconds` after its start.
    fn gain(&self, clip: &AudioClip, seconds: f64) -> f32 {
        let mut g = match &clip.envelope {
            Some(e) if !e.is_empty() => {
                let x = (seconds * self.fps).max(0.0);
                let i = (x.floor() as usize).min(e.len() - 1);
                let next = e[(i + 1).min(e.len() - 1)];
                e[i] + (next - e[i]) * (x - i as f64) as f32
            }
            _ => clip.volume,
        };
        if clip.fade_in > 0.0 && seconds < clip.fade_in {
            g *= (seconds / clip.fade_in) as f32;
        }
        let left = clip.end - clip.start - seconds;
        if clip.fade_out > 0.0 && left < clip.fade_out {
            g *= (left / clip.fade_out).max(0.0) as f32;
        }
        g
    }
}
