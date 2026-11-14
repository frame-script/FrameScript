//! The studio window: the preview above, the transport and the timeline below.
//!
//! The UI thread never runs the project's scripts. It tells the preview worker which frame it
//! wants and how big, and draws the scenes that come back; scrubbing stays smooth however long a
//! frame takes, and a wish the worker hasn't got to is replaced by the next one.

use crate::export::{Exporter, summary};
use crate::preview::{Preview, PreviewFrame};
use crate::timeline::{timecode, timeline};
use anti_webui::prelude::*;
use anti_webui_md3e::components::sized_icon;
use anti_webui_md3e::{ColorScheme, icons, set_color_scheme};
use framescript_engine::worker::{Event, PreviewWorker};
use framescript_engine::{AudioPlayer, FrameTimings, ProjectInfo, ProjectSettings};
use std::cell::Cell;
use std::path::PathBuf;
use std::rc::Rc;

/// The project as the worker last loaded it.
#[derive(Clone, PartialEq)]
pub struct Project {
    pub settings: ProjectSettings,
    pub info: ProjectInfo,
}

#[derive(Clone, Copy, PartialEq)]
struct Stats {
    frame: u32,
    timings: FrameTimings,
    size: (u32, u32),
    /// Every video shows the frame it should, rather than the closest one decoded so far.
    complete: bool,
}

pub fn run(dir: PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    let title = format!("FrameScript2 — {}", dir.display());
    App::new()
        .title(title)
        .app_id("dev.framescript.studio")
        .size(1280, 860)
        .run(move || studio(dir))
}

fn studio(dir: PathBuf) -> impl IntoView {
    set_theme(Theme::dark());
    set_color_scheme(ColorScheme::dark());
    let project = signal(None::<Project>);
    let frame = signal(0u32);
    let shown = signal(None::<PreviewFrame>);
    let error = signal(None::<String>);
    let stats = signal(None::<Stats>);
    let playing = signal(false);
    let loaded_in = signal(0.0f64);

    let player = Rc::new(AudioPlayer::new());
    let seq = Cell::new(0u64);
    let sender = ui_channel({
        let player = player.clone();
        move |event: Event| match event {
            Event::Loaded {
                settings,
                info,
                audio,
                took,
            } => {
                player.set_plan(audio);
                let last = info.duration_frames.saturating_sub(1);
                if frame.get_untracked() > last {
                    frame.set(last);
                }
                project.set(Some(Project { settings, info }));
                loaded_in.set(took.as_secs_f64() * 1000.0);
                error.set(None);
            }
            Event::Frame(rendered) => {
                seq.set(seq.get() + 1);
                stats.set(Some(Stats {
                    frame: rendered.frame,
                    timings: rendered.timings,
                    size: (rendered.scene.width, rendered.scene.height),
                    complete: rendered.complete,
                }));
                shown.set(Some(PreviewFrame {
                    seq: seq.get(),
                    scene: rendered.scene,
                }));
                error.set(None);
            }
            Event::Failed(message) => {
                eprintln!("{message}");
                error.set(Some(message));
            }
        }
    });
    let exporter = Exporter::new(dir.clone(), project);
    on_cleanup({
        let exporter = exporter.clone();
        move || exporter.stop()
    });
    let worker = Rc::new(PreviewWorker::spawn(dir, move |event| sender.send(event)));
    effect({
        let worker = worker.clone();
        move || worker.seek(frame.get())
    });

    // Moving the playhead by hand lets what is there be heard for a moment.
    effect({
        let player = player.clone();
        let first = Cell::new(true);
        move || {
            let f = frame.get();
            if !first.replace(false) && !playing.get_untracked() {
                let fps = project.with_untracked(|p| p.as_ref().map_or(60.0, |p| p.settings.fps));
                player.scrub(f as f64 / fps.max(1.0));
            }
        }
    });

    effect(move || {
        if playing.get() {
            play(project, frame, playing, player.clone());
        } else {
            player.stop();
        }
    });

    let root = node_ref();
    request_frame(move |_| root.focus());

    div()
        .node_ref(root)
        .size_full()
        .flex()
        .flex_col()
        .bg(Color::from_rgb(0x0d0f14))
        .text_color(Color::from_rgb(0xe5e7eb))
        .focusable()
        .on_key_down(move |e| keys(e, project, frame, playing))
        .child(preview_area(worker, shown, error))
        .child(transport(project, frame, playing, stats, loaded_in, exporter))
        .child(timeline(project, frame))
}

fn preview_area(
    worker: Rc<PreviewWorker>,
    shown: Signal<Option<PreviewFrame>>,
    error: Signal<Option<String>>,
) -> Div {
    let size = signal((1.0f32, 1.0f32));
    div()
        .flex_1()
        .min_h(0.0)
        .relative()
        .bg(Color::from_rgb(0x050608))
        .on_resized(move |w, h| {
            size.set((w, h));
            let scale = window_scale().as_f64();
            worker.fit((w as f64 * scale) as u32, (h as f64 * scale) as u32);
        })
        .child(
            gpu_canvas::<Preview>(move || shown.get())
                .absolute()
                .left(0.0)
                .top(0.0)
                .dyn_style(move |s| {
                    let (w, h) = size.get();
                    s.w(w).h(h)
                }),
        )
        .child(dyn_view(move || {
            error.get().map(|message| {
                div()
                    .absolute()
                    .left(16.0)
                    .right(16.0)
                    .bottom(16.0)
                    .p(14.0)
                    .rounded(8.0)
                    .bg(Color::from_rgba(0x450a0ae6))
                    .border(1.0)
                    .border_color(Color::from_rgb(0xb91c1c))
                    .child(
                        text(message)
                            .text_size(13.0)
                            .font_family("monospace")
                            .text_color(Color::from_rgb(0xfecaca)),
                    )
            })
        }))
}

fn transport(
    project: Signal<Option<Project>>,
    frame: Signal<u32>,
    playing: Signal<bool>,
    stats: Signal<Option<Stats>>,
    loaded_in: Signal<f64>,
    exporter: Rc<Exporter>,
) -> Div {
    let fps = move || project.with(|p| p.as_ref().map_or(60.0, |p| p.settings.fps));
    let last = move || project.with(|p| p.as_ref().map_or(0, |p| p.info.duration_frames.saturating_sub(1)));

    div()
        .flex()
        .flex_row()
        .items_center()
        .gap(6.0)
        .h(48.0)
        .px(12.0)
        .bg(Color::from_rgb(0x12141b))
        .border_t(1.0)
        .border_color(Color::from_rgb(0x262a36))
        .child(tool(icons::SKIP_PREVIOUS, move || {
            playing.set(false);
            frame.set(0);
        }))
        .child(dyn_view(move || {
            let symbol = if playing.get() { icons::PAUSE } else { icons::PLAY_ARROW };
            tool(symbol, move || playing.update(|p| *p = !*p))
        }))
        .child(tool(icons::SKIP_NEXT, move || {
            playing.set(false);
            frame.set(last());
        }))
        .child(
            text(move || timecode(frame.get(), fps()))
                .ml(10.0)
                .text_size(18.0)
                .font_family("monospace")
                .text_color(Color::from_rgb(0xf8fafc)),
        )
        .child(
            text(move || format!("{} / {}", frame.get(), last()))
                .ml(8.0)
                .text_size(13.0)
                .text_color(Color::from_rgb(0x8b93a7)),
        )
        .child(div().flex_1())
        .child(
            text(move || {
                let mut s = match project.get() {
                    Some(p) => format!(
                        "{} · {}×{} · {} fps · loaded in {:.0} ms",
                        p.settings.name,
                        p.settings.width,
                        p.settings.height,
                        p.settings.fps,
                        loaded_in.get()
                    ),
                    None => "loading…".into(),
                };
                if let Some(st) = stats.get() {
                    let ms = |d: std::time::Duration| d.as_secs_f64() * 1000.0;
                    s += &format!(
                        "  ·  frame {} at {}×{}: script {:.2} ms, layout {:.2} ms, paint {:.2} ms",
                        st.frame,
                        st.size.0,
                        st.size.1,
                        ms(st.timings.script),
                        ms(st.timings.layout),
                        ms(st.timings.paint)
                    );
                    if !st.complete {
                        s += "  ·  decoding…";
                    }
                }
                s
            })
            .text_size(12.0)
            .text_color(Color::from_rgb(0x8b93a7)),
        )
        .child({
            let exporter = exporter.clone();
            dyn_view(move || {
                summary(&exporter).map(|s| {
                    text(s)
                        .ml(12.0)
                        .text_size(12.0)
                        .text_color(Color::from_rgb(0x7dd3fc))
                })
            })
        })
        .child(tool(icons::MOVIE, move || exporter.open()).ml(6.0))
}

fn tool(symbol: &'static anti_webui_md3e::icons::Symbol, action: impl Fn() + 'static) -> Div {
    div()
        .w(34.0)
        .h(34.0)
        .rounded(8.0)
        .flex()
        .items_center()
        .justify_center()
        .hover(|s| s.bg(Color::from_rgba(0xffffff14)))
        .active(|s| s.bg(Color::from_rgba(0xffffff26)))
        .on_click(move |_| action())
        .child(sized_icon(symbol, 22.0))
}

/// Space plays and pauses, the arrows step a frame (a second with Shift), Home and End go to the
/// ends.
fn keys(e: &KeyboardEvent, project: Signal<Option<Project>>, frame: Signal<u32>, playing: Signal<bool>) {
    let Some(p) = project.get_untracked() else {
        return;
    };
    let last = p.info.duration_frames.saturating_sub(1);
    let step = if e.modifiers.shift { p.settings.fps.round() as u32 } else { 1 };
    let seek = |f: u32| {
        playing.set(false);
        frame.set(f.min(last));
    };
    match &e.key {
        Key::Named(NamedKey::Space) => playing.update(|p| *p = !*p),
        Key::Named(NamedKey::ArrowLeft) => seek(frame.get_untracked().saturating_sub(step)),
        Key::Named(NamedKey::ArrowRight) => seek(frame.get_untracked() + step),
        Key::Named(NamedKey::Home) => seek(0),
        Key::Named(NamedKey::End) => seek(last),
        _ => {}
    }
}

/// Moves the frame with the sound while `playing`, from where it is, around to the start at the
/// end: the frame is that of what is being heard (or of the time that went by, without sound). The
/// worker shows the latest frame it can: when it can't keep up, frames are skipped, not slowed
/// down.
fn play(project: Signal<Option<Project>>, frame: Signal<u32>, playing: Signal<bool>, player: Rc<AudioPlayer>) {
    let Some(p) = project.get_untracked() else {
        playing.set(false);
        return;
    };
    let total = p.info.duration_frames.max(1);
    let fps = p.settings.fps.max(1.0);
    let from = if frame.get_untracked() + 1 >= total { 0 } else { frame.get_untracked() };
    player.play(from as f64 / fps, total as f64 / fps);
    fn next(
        player: Rc<AudioPlayer>,
        set: Option<u32>,
        total: u32,
        fps: f64,
        frame: Signal<u32>,
        playing: Signal<bool>,
    ) {
        request_frame(move |_| {
            if !playing.get_untracked() {
                return;
            }
            let now = frame.get_untracked();
            // Moved by hand while playing (on the timeline): playing goes on from there.
            if set.is_some_and(|f| f != now) {
                player.play(now as f64 / fps, total as f64 / fps);
            }
            let mut set = Some(now);
            if let Some(at) = player.position() {
                let f = ((at * fps + 1e-6) as u32).min(total - 1);
                frame.set(f);
                set = Some(f);
            }
            next(player, set, total, fps, frame, playing);
        });
    }
    next(player, None, total, fps, frame, playing);
}
