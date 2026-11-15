//! A thread of its own for a composition, for the preview.
//!
//! The UI thread only says which frame it would like to see; the worker makes the latest of that
//! and hands the [`Scene`] back, at the project's size (the preview draws it at its own). While it is busy, wishes replace one another, so
//! scrubbing never queues up frames nobody will look at. It also loads the project again when its
//! files change, keeping the frames of videos it has decoded.
//!
//! A frame isn't held up by a video that hasn't decoded what it shows: it comes with the closest
//! frame of that video there is, and again when the right one is there, unless something else is
//! wanted by then.

use crate::composition::{Composition, FrameTimings, ProjectInfo, ProjectSettings, Wait};
use crate::media::Media;
use crate::sound::AudioPlan;
use anti_webui_core::scene::Scene;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime};

pub enum Event {
    /// The project was loaded (again): what it is, how far it goes, and what sound plays when.
    Loaded {
        settings: ProjectSettings,
        info: ProjectInfo,
        audio: Arc<AudioPlan>,
        took: Duration,
    },
    /// Loading or making a frame failed. What was shown before can stay.
    Failed(String),
    Frame(RenderedFrame),
}

pub struct RenderedFrame {
    pub frame: u32,
    pub scene: Arc<Scene>,
    pub timings: FrameTimings,
    /// Goes up with every load, so that a frame can be told from one of an older version.
    pub generation: u64,
    /// Whether every video in it shows the frame it should. If not, the frame comes again.
    pub complete: bool,
}

#[derive(Clone, Copy, PartialEq)]
struct Wish {
    frame: u32,
}

struct State {
    wish: Wish,
    reload: bool,
    /// A frame of a video that was shown something else in place of has come.
    media: bool,
    quit: bool,
}

struct Shared {
    state: Mutex<State>,
    wake: Condvar,
}

pub struct PreviewWorker {
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
}

/// How often the files of the project are looked at while nothing else happens.
const WATCH: Duration = Duration::from_millis(400);

impl PreviewWorker {
    pub fn spawn(dir: PathBuf, send: impl Fn(Event) + Send + 'static) -> Self {
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                wish: Wish { frame: 0 },
                reload: true,
                media: false,
                quit: false,
            }),
            wake: Condvar::new(),
        });
        let thread = std::thread::Builder::new()
            .name("framescript-preview".into())
            .spawn({
                let shared = shared.clone();
                move || run(&dir, &shared, &send)
            })
            .expect("a thread can be started");
        Self {
            shared,
            thread: Some(thread),
        }
    }

    pub fn seek(&self, frame: u32) {
        self.change(|s| s.wish.frame = frame);
    }

    pub fn reload(&self) {
        self.change(|s| s.reload = true);
    }

    fn change(&self, f: impl FnOnce(&mut State)) {
        f(&mut self.shared.state.lock().expect("no panics with the lock"));
        self.shared.wake.notify_one();
    }
}

impl Drop for PreviewWorker {
    fn drop(&mut self) {
        self.change(|s| s.quit = true);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn run(dir: &Path, shared: &Arc<Shared>, send: &dyn Fn(Event)) {
    let library = crate::loader::default_library_dir();
    let mut composition: Option<Composition> = None;
    let mut generation = 0;
    let mut done: Option<Wish> = None;
    // Whether what was made for `done` is to be made again when frames of videos come.
    let mut incomplete = false;
    let mut stamp = stamp_of(&[dir, &library]);
    let media = Media::new();
    media.set_listener({
        let shared = shared.clone();
        move || {
            shared.state.lock().expect("no panics with the lock").media = true;
            shared.wake.notify_one();
        }
    });

    loop {
        let (wish, reload) = {
            let mut state = shared.state.lock().expect("no panics with the lock");
            loop {
                if state.quit {
                    return;
                }
                let again = incomplete && state.media;
                if state.reload || (composition.is_some() && (done != Some(state.wish) || again)) {
                    break;
                }
                let (next, timeout) = shared
                    .wake
                    .wait_timeout(state, WATCH)
                    .expect("no panics with the lock");
                state = next;
                if timeout.timed_out() {
                    let now = stamp_of(&[dir, &library]);
                    if now != stamp {
                        stamp = now;
                        state.reload = true;
                    }
                }
            }
            // What comes from here on is for what is made now.
            state.media = false;
            (state.wish, std::mem::take(&mut state.reload))
        };

        if reload {
            // The old one goes first: it holds the thread's document and V8.
            composition = None;
            done = None;
            let t = Instant::now();
            let loaded = Composition::load_with(dir, media.clone());
            media.collect();
            match loaded {
                Ok(c) => {
                    generation += 1;
                    send(Event::Loaded {
                        settings: c.settings().clone(),
                        info: c.info().clone(),
                        audio: c.audio().clone(),
                        took: t.elapsed(),
                    });
                    composition = Some(c);
                }
                Err(e) => {
                    send(Event::Failed(e.to_string()));
                    continue;
                }
            }
        }

        let Some(c) = composition.as_mut() else {
            continue;
        };
        incomplete = false;
        match c.render_with(wish.frame, Wait::PREVIEW) {
            Ok(r) => {
                incomplete = !r.complete;
                send(Event::Frame(RenderedFrame {
                    frame: wish.frame,
                    scene: Arc::new(r.scene),
                    timings: r.timings,
                    generation,
                    complete: r.complete,
                }))
            }
            Err(e) => send(Event::Failed(e.to_string())),
        }
        done = Some(wish);
    }
}

/// Something that changes when a file under the directories does: the latest modification and
/// how many files there are (for deletions).
fn stamp_of(dirs: &[&Path]) -> (Option<SystemTime>, usize) {
    let mut latest = None;
    let mut count = 0;
    let mut stack: Vec<PathBuf> = dirs.iter().map(|d| d.to_path_buf()).collect();
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') || name == "node_modules" || name == "target" {
                continue;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                count += 1;
                latest = latest.max(meta.modified().ok());
            }
        }
    }
    (latest, count)
}
