//! Playing the sound of a composition, for the preview.
//!
//! While it plays, the sound is the clock: [`AudioPlayer::position`] is where on the timeline
//! what is being heard is, and the preview shows the frame of that. The picture then never runs
//! away from the sound, however the frames come. Where there is nowhere for sound to go, or
//! nothing to hear, the clock is the time that went by.
//!
//! Moving the playhead by hand plays a moment of the sound there, as editors do.

use crate::sound::{AudioPlan, RATE};
use anti_webui_video::AudioOutput;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// Pairs mixed and handed to the device at a time: 10 ms.
const PIECE: usize = RATE as usize / 100;
/// How long a moment of sound is when the playhead is moved by hand.
const SCRUB: f64 = 0.08;
/// Pairs at the ends of such a moment that come up from and go down to silence, so that it
/// doesn't click.
const EDGE: usize = RATE as usize / 400;
/// How long the start of playing waits for sound that isn't decoded yet, and what comes after.
const FIRST_WAIT: Duration = Duration::from_millis(60);
const WAIT: Duration = Duration::from_millis(2);
/// How far ahead of the time that went by it writes at most, for a device that takes everything
/// at once.
const MAX_AHEAD: f64 = 1.0;
/// How much of the difference between what the device says and the clock is taken in each time it
/// says, at first and then: what it says goes in steps, and the clock goes smoothly.
const FIRST_FOLLOW: f64 = 0.3;
const FOLLOW: f64 = 0.05;

#[derive(Clone, Copy, PartialEq)]
enum Task {
    Idle,
    /// From `from` to `end` and around again, in seconds.
    Play { from: f64, end: f64 },
    Scrub(f64),
}

/// How far it has played, in seconds from `from`, going around at `end`.
#[derive(Clone, Copy)]
enum Clock {
    /// The time since `started`.
    Wall { started: Instant },
    /// The time since the device was first written to at `started`, and `offset` (less than
    /// nothing: what the device holds and what it took to start), once the device has said.
    Device { started: Instant, offset: Option<f64> },
}

struct State {
    plan: Arc<AudioPlan>,
    task: Task,
    /// Goes up with every task.
    generation: u64,
    clock: Clock,
    /// The furthest the clock was said to be, which it never goes back from.
    said: f64,
    quit: bool,
}

impl State {
    fn played(&mut self, now: Instant) -> f64 {
        let played = match self.clock {
            Clock::Wall { started } => now.saturating_duration_since(started).as_secs_f64(),
            Clock::Device { offset: None, .. } => 0.0,
            Clock::Device {
                started,
                offset: Some(offset),
            } => now.saturating_duration_since(started).as_secs_f64() + offset,
        };
        self.said = self.said.max(played);
        self.said
    }
}

struct Shared {
    state: Mutex<State>,
    changed: Condvar,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().expect("no panics with the lock")
    }
}

pub struct AudioPlayer {
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
}

impl Default for AudioPlayer {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioPlayer {
    pub fn new() -> Self {
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                plan: Arc::new(AudioPlan::empty()),
                task: Task::Idle,
                generation: 0,
                clock: Clock::Wall {
                    started: Instant::now(),
                },
                said: 0.0,
                quit: false,
            }),
            changed: Condvar::new(),
        });
        let thread = std::thread::Builder::new()
            .name("framescript-playback".into())
            .spawn({
                let shared = shared.clone();
                move || run(&shared)
            })
            .expect("a thread can be started");
        Self {
            shared,
            thread: Some(thread),
        }
    }

    /// What to play from now on: the plan of the project as it was loaded last. Playing goes on
    /// where it is.
    pub fn set_plan(&self, plan: Arc<AudioPlan>) {
        self.shared.lock().plan = plan;
        self.shared.changed.notify_all();
    }

    /// Plays from `from` seconds, around to the start at `end`.
    pub fn play(&self, from: f64, end: f64) {
        self.set(Task::Play {
            from: from.max(0.0),
            end: end.max(1.0 / RATE as f64),
        });
    }

    pub fn stop(&self) {
        self.set(Task::Idle);
    }

    /// Plays a moment of the sound at `seconds`, unless it is playing.
    pub fn scrub(&self, seconds: f64) {
        self.set(Task::Scrub(seconds));
    }

    /// Where on the timeline what is being heard is, in seconds, while it plays. It only goes
    /// forward (and around).
    pub fn position(&self) -> Option<f64> {
        let mut state = self.shared.lock();
        let Task::Play { from, end } = state.task else {
            return None;
        };
        Some((from + state.played(Instant::now())).rem_euclid(end))
    }

    fn set(&self, task: Task) {
        let mut state = self.shared.lock();
        state.task = task;
        state.generation += 1;
        state.clock = Clock::Wall {
            started: Instant::now(),
        };
        state.said = 0.0;
        drop(state);
        self.shared.changed.notify_all();
    }
}

impl Drop for AudioPlayer {
    fn drop(&mut self) {
        self.shared.lock().quit = true;
        self.shared.changed.notify_all();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn run(shared: &Shared) {
    let mut output: Option<AudioOutput> = None;
    let mut tried = false;
    let mut handled = 0;
    let mut mixed = vec![0.0f32; PIECE * 2];
    let mut pcm = Vec::with_capacity(PIECE * 2);
    // While playing: the next pair to mix, how many have gone to the device since when, and how
    // far behind that what is heard is.
    let mut cursor = 0i64;
    let mut written = 0i64;
    let mut started = Instant::now();
    let mut offset: Option<f64> = None;
    let mut said = 0;

    loop {
        let (task, plan, fresh) = {
            let mut state = shared.lock();
            loop {
                if state.quit {
                    return;
                }
                let plays = matches!(state.task, Task::Play { .. }) && !state.plan.is_empty();
                if state.generation != handled || (plays && output.is_some()) {
                    break;
                }
                if !plays {
                    to_wall(&mut state);
                }
                state = shared.changed.wait(state).expect("no panics with the lock");
            }
            let fresh = state.generation != handled;
            handled = state.generation;
            (state.task, state.plan.clone(), fresh)
        };
        if plan.is_empty() {
            if fresh && let Some(out) = &mut output {
                out.flush();
            }
            continue;
        }
        if output.is_none() && !tried {
            tried = true;
            output = AudioOutput::open(RATE);
            if output.is_none() {
                eprintln!("framescript: nowhere for sound to go; the preview plays without it");
            }
        }
        let Some(out) = output.as_mut() else {
            continue;
        };
        match task {
            Task::Idle => {
                if fresh {
                    out.flush();
                }
            }
            Task::Scrub(at) => {
                if fresh {
                    out.flush();
                    let mut moment = vec![0.0f32; (SCRUB * RATE as f64) as usize * 2];
                    plan.mix(pair(at), &mut moment, FIRST_WAIT);
                    edges(&mut moment);
                    if !write(out, &moment, &mut pcm) {
                        output = None;
                    }
                }
            }
            Task::Play { from, end } => {
                if fresh {
                    out.flush();
                    cursor = pair(from);
                    written = 0;
                    started = Instant::now();
                    offset = None;
                    said = 0;
                    let mut state = shared.lock();
                    if state.generation == handled {
                        state.clock = Clock::Device {
                            started,
                            offset: None,
                        };
                    }
                }
                // Around to the start; the clock goes around by itself.
                let last = pair(end).max(1);
                if cursor >= last {
                    cursor = 0;
                }
                let n = PIECE.min((last - cursor) as usize);
                let wait = if started.elapsed() < Duration::from_millis(100) {
                    FIRST_WAIT
                } else {
                    WAIT
                };
                plan.mix(cursor, &mut mixed[..n * 2], wait);
                if !write(out, &mixed[..n * 2], &mut pcm) {
                    output = None;
                    to_wall(&mut shared.lock());
                    continue;
                }
                cursor += n as i64;
                written += n as i64;
                let elapsed = started.elapsed().as_secs_f64();
                let ahead = written as f64 / RATE as f64 - elapsed;
                if ahead > MAX_AHEAD {
                    std::thread::sleep(Duration::from_secs_f64(ahead - MAX_AHEAD));
                }
                // Nothing is heard sooner than the time it takes, whatever the device says.
                let heard = (written as f64 / RATE as f64 - out.delay()).min(elapsed);
                let measured = heard - elapsed;
                let follow = if said < 30 { FIRST_FOLLOW } else { FOLLOW };
                said += 1;
                let o = offset.map_or(measured, |o| o + (measured - o) * follow);
                offset = Some(o);
                let mut state = shared.lock();
                if state.generation == handled {
                    state.clock = Clock::Device {
                        started,
                        offset: Some(o),
                    };
                }
            }
        }
    }
}

/// Goes on playing by the time that goes by, from where it is.
fn to_wall(state: &mut State) {
    if let (Task::Play { from, end }, Clock::Device { .. }) = (state.task, state.clock) {
        let now = Instant::now();
        let at = (from + state.played(now)).rem_euclid(end);
        state.task = Task::Play { from: at, end };
        state.clock = Clock::Wall { started: now };
        state.said = 0.0;
    }
}

fn pair(seconds: f64) -> i64 {
    (seconds * RATE as f64).round() as i64
}

/// Comes up from silence at the start and goes down to it at the end.
fn edges(samples: &mut [f32]) {
    let pairs = samples.len() / 2;
    let edge = EDGE.min(pairs / 2).max(1);
    for i in 0..edge {
        let g = i as f32 / edge as f32;
        for ch in 0..2 {
            samples[i * 2 + ch] *= g;
            samples[(pairs - 1 - i) * 2 + ch] *= g;
        }
    }
}

/// Hands `samples` to the device as 16 bits. Returns whether that worked.
fn write(out: &mut AudioOutput, samples: &[f32], pcm: &mut Vec<i16>) -> bool {
    pcm.clear();
    pcm.extend(samples.iter().map(|s| (s * 32768.0).round().clamp(-32768.0, 32767.0) as i16));
    out.write(pcm)
}
