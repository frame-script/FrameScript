//! The studio window: what the project is above, the preview, the transport and the timeline
//! below, and how the last frame went at the bottom.
//!
//! The UI thread never runs the project's scripts. It tells the preview worker which frame it
//! wants and how big, and draws the scenes that come back; scrubbing stays smooth however long a
//! frame takes, and a wish the worker hasn't got to is replaced by the next one.

use crate::export::{Exporter, summary};
use crate::preview::{Preview, PreviewFrame};
use crate::settings::{Settings, SettingsWindow};
use crate::timeline::{Timeline, timecode, zoom_controls};
use anti_webui::core::drag::GrabPhase;
use anti_webui::prelude::*;
use anti_webui_md3e::components::{
    ButtonStyle, IconButtonStyle, IconButtonWidth, loading_indicator, sized_icon, styled_button,
    styled_icon_button, tooltip,
};
use anti_webui_md3e::typography::{FONT_FAMILY, TextStyle};
use anti_webui_md3e::{Density, color_scheme, icons, set_density};
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
    // What the project is called until it has loaded: its folder.
    let name = dir.file_name().map_or_else(
        || dir.display().to_string(),
        |n| n.to_string_lossy().into_owned(),
    );
    let settings = Settings::load();
    settings.apply(false);
    let settings = SettingsWindow::new(settings);
    // A tool for the pointer, with many controls in a window.
    set_density(Density::Compact);
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
    let timeline = Timeline::new(project, frame);
    // The height of the timeline below the transport, which the bar above it changes.
    let lanes = signal(190.0f32);
    let window_h = signal(860.0f32);

    div()
        .node_ref(root)
        .size_full()
        .flex()
        .flex_col()
        .font_family(FONT_FAMILY)
        .on_resized(move |_, h| window_h.set(h))
        .dyn_style(|s| {
            let c = color_scheme();
            s.bg(c.surface).text_color(c.on_surface)
        })
        .focusable()
        .on_key_down(move |e| keys(e, project, frame, playing, timeline))
        .child(top_bar(name, project, exporter, settings))
        .child(preview_area(project, shown, error))
        .child(splitter(lanes, window_h))
        .child(transport(project, frame, playing, timeline))
        .child(
            div()
                .flex()
                .flex_col()
                .flex_none()
                .dyn_style(move |s| s.h(lanes.get()))
                .dyn_style(|s| s.bg(color_scheme().surface_container_low))
                .child(timeline.view()),
        )
        .child(status_bar(project, error, stats, loaded_in))
}

/// What the project is, and the way out: exporting it.
fn top_bar(
    name: String,
    project: Signal<Option<Project>>,
    exporter: Rc<Exporter>,
    settings: Rc<SettingsWindow>,
) -> Div {
    let summary_of = exporter.clone();
    div()
        .flex()
        .flex_row()
        .flex_none()
        .items_center()
        .gap(10.0)
        .h(48.0)
        .px(16.0)
        .border_b(1.0)
        .dyn_style(|s| {
            let c = color_scheme();
            s.bg(c.surface_container).border_color(c.outline_variant)
        })
        .child(
            sized_icon(icons::MOVIE_EDIT, 20.0).dyn_style(|s| s.text_color(color_scheme().primary)),
        )
        .child(TextStyle::TITLE_SMALL.apply(text(move || {
            project.with(|p| {
                p.as_ref()
                    .map_or_else(|| name.clone(), |p| p.settings.name.clone())
            })
        })))
        .child(dyn_view(move || {
            project.get().map(|p| {
                let s = &p.settings;
                let seconds = p.info.duration_frames as f64 / s.fps.max(1.0);
                let facts = [
                    format!("{}×{}", s.width, s.height),
                    format!("{} fps", s.fps),
                    format!("{seconds:.1} s"),
                ];
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap(6.0)
                    .children(facts.map(|f| {
                        TextStyle::LABEL_MEDIUM
                            .apply(
                                div()
                                    .px(8.0)
                                    .h(22.0)
                                    .flex()
                                    .items_center()
                                    .rounded(11.0)
                                    .child(text(f)),
                            )
                            .dyn_style(|s| {
                                let c = color_scheme();
                                s.bg(c.surface_container_highest)
                                    .text_color(c.on_surface_variant)
                            })
                    }))
            })
        }))
        .child(div().flex_1())
        .child(dyn_view(move || {
            summary(&summary_of).map(|line| {
                TextStyle::LABEL_LARGE
                    .apply(text(line))
                    .dyn_style(|s| s.text_color(color_scheme().primary))
            })
        }))
        .child(tooltip(
            styled_icon_button(icons::SETTINGS, IconButtonStyle::standard())
                .on_click(move |_| settings.open()),
            "Settings",
        ))
        .child(
            styled_button("Export", ButtonStyle::tonal().icon(icons::FILE_EXPORT))
                .on_click(move |_| exporter.open()),
        )
}

fn preview_area(
    project: Signal<Option<Project>>,
    shown: Signal<Option<PreviewFrame>>,
    error: Signal<Option<String>>,
) -> Div {
    let size = signal((1.0f32, 1.0f32));
    let picture = div()
        .flex_1()
        .min_h(0.0)
        .relative()
        .on_resized(move |w, h| size.set((w, h)))
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
            let loading = project.with(|p| p.is_none()) && error.with(|e| e.is_none());
            loading.then(|| {
                div()
                    .absolute()
                    .inset(0.0)
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap(12.0)
                    .child(loading_indicator())
                    .child(
                        TextStyle::BODY_MEDIUM
                            .apply(text("Loading the project…"))
                            .dyn_style(|s| s.text_color(color_scheme().on_surface_variant)),
                    )
            })
        }))
        .child(dyn_view(move || {
            error.get().map(|message| {
                div()
                    .absolute()
                    .left(0.0)
                    .right(0.0)
                    .bottom(0.0)
                    .flex()
                    .flex_row()
                    .gap(12.0)
                    .p(14.0)
                    .rounded(12.0)
                    .dyn_style(|s| {
                        let c = color_scheme();
                        s.bg(c.error_container).text_color(c.on_error_container)
                    })
                    .child(sized_icon(icons::ERROR, 20.0).flex_none())
                    .child(
                        text(message)
                            .flex_1()
                            .min_w(0.0)
                            .text_size(13.0)
                            .font_family("monospace"),
                    )
            })
        }));
    div()
        .flex_1()
        .min_h(0.0)
        .flex()
        .p(16.0)
        .dyn_style(|s| {
            // Darker than what is around it either way, so that a light picture stands out.
            let c = color_scheme();
            let dark = c.surface.r + c.surface.g + c.surface.b < 1.5;
            s.bg(if dark {
                c.surface_container_lowest
            } else {
                c.surface_dim
            })
        })
        .child(picture)
}

/// The edge above the transport, which drags the timeline higher or lower.
fn splitter(lanes: Signal<f32>, window_h: Signal<f32>) -> Div {
    let hovered = signal(false);
    let held = signal(false);
    div()
        .relative()
        .flex_none()
        .h(1.0)
        .z_index(3)
        .dyn_style(|s| s.bg(color_scheme().outline_variant))
        .child(
            div()
                .absolute()
                .left(0.0)
                .right(0.0)
                .top(-3.0)
                .h(7.0)
                .cursor(CursorIcon::NsResize)
                .on_hover(move |on| hovered.set(on))
                .grab_threshold(0.0)
                .on_grab(move |e| {
                    held.set(!matches!(e.phase, GrabPhase::End | GrabPhase::Cancel));
                    if matches!(e.phase, GrabPhase::Move) {
                        let most = (window_h.get_untracked() - 260.0).max(120.0);
                        lanes.update(|h| *h = (*h - e.delta.y).clamp(80.0, most));
                    }
                })
                .child(
                    div()
                        .absolute()
                        .left(0.0)
                        .right(0.0)
                        .top(2.0)
                        .h(3.0)
                        .dyn_style(move |s| {
                            let c = color_scheme();
                            let on = hovered.get() || held.get();
                            s.bg(if on { c.primary } else { Color::TRANSPARENT })
                        }),
                ),
        )
}

fn transport(
    project: Signal<Option<Project>>,
    frame: Signal<u32>,
    playing: Signal<bool>,
    timeline: Timeline,
) -> Div {
    let fps = move || project.with(|p| p.as_ref().map_or(60.0, |p| p.settings.fps));
    let last = move || {
        project.with(|p| {
            p.as_ref()
                .map_or(0, |p| p.info.duration_frames.saturating_sub(1))
        })
    };
    let step = move |by: i64| {
        playing.set(false);
        frame.set((frame.get_untracked() as i64 + by).clamp(0, last() as i64) as u32);
    };
    let button = |symbol, label: &str, action: Box<dyn Fn()>| {
        tooltip(
            styled_icon_button(symbol, IconButtonStyle::standard()).on_click(move |_| action()),
            label,
        )
    };
    let side = || {
        div()
            .flex()
            .flex_row()
            .items_center()
            .flex_1()
            .flex_basis(0.0)
            .min_w(0.0)
    };

    div()
        .flex()
        .flex_row()
        .flex_none()
        .items_center()
        .h(52.0)
        .px(16.0)
        .dyn_style(|s| s.bg(color_scheme().surface_container))
        .child(
            side()
                .gap(10.0)
                .child(
                    text(move || timecode(frame.get(), fps()))
                        .text_size(20.0)
                        .font_family("monospace")
                        .dyn_style(|s| s.text_color(color_scheme().on_surface)),
                )
                .child(
                    TextStyle::BODY_SMALL
                        .apply(text(move || format!("/ {}", timecode(last() + 1, fps()))))
                        .font_family("monospace")
                        .dyn_style(|s| s.text_color(color_scheme().on_surface_variant)),
                )
                .child(
                    TextStyle::LABEL_MEDIUM
                        .apply(text(move || format!("frame {}", frame.get())))
                        .ml(6.0)
                        .dyn_style(|s| s.text_color(color_scheme().on_surface_variant)),
                ),
        )
        .child(
            div()
                .flex()
                .flex_row()
                .items_center()
                .gap(4.0)
                .child(button(
                    icons::SKIP_PREVIOUS,
                    "To the start (Home)",
                    Box::new(move || {
                        playing.set(false);
                        frame.set(0);
                    }),
                ))
                .child(button(
                    icons::CHEVRON_LEFT,
                    "A frame back (←)",
                    Box::new(move || step(-1)),
                ))
                .child(dyn_view(move || {
                    let (symbol, label) = if playing.get() {
                        (icons::PAUSE, "Pause (Space)")
                    } else {
                        (icons::PLAY_ARROW, "Play (Space)")
                    };
                    tooltip(
                        styled_icon_button(
                            symbol,
                            IconButtonStyle::filled().width(IconButtonWidth::Wide),
                        )
                        .on_click(move |_| playing.update(|p| *p = !*p)),
                        label,
                    )
                }))
                .child(button(
                    icons::CHEVRON_RIGHT,
                    "A frame on (→)",
                    Box::new(move || step(1)),
                ))
                .child(button(
                    icons::SKIP_NEXT,
                    "To the end (End)",
                    Box::new(move || {
                        playing.set(false);
                        frame.set(last());
                    }),
                )),
        )
        .child(side().justify_end().child(zoom_controls(timeline)))
}

/// A line of the status bar.
fn item(f: impl Fn() -> String + 'static) -> Text {
    TextStyle::LABEL_SMALL
        .apply(text(f))
        .font_weight(FontWeight(400))
        .whitespace_nowrap()
}

/// How the last frame went, at the bottom.
fn status_bar(
    project: Signal<Option<Project>>,
    error: Signal<Option<String>>,
    stats: Signal<Option<Stats>>,
    loaded_in: Signal<f64>,
) -> Div {
    div()
        .flex()
        .flex_row()
        .flex_none()
        .items_center()
        .gap(16.0)
        .h(26.0)
        .px(16.0)
        .border_t(1.0)
        .dyn_style(|s| {
            let c = color_scheme();
            s.bg(c.surface_container)
                .border_color(c.outline_variant)
                .text_color(c.on_surface_variant)
        })
        .child(item(move || {
            match (project.with(Option::is_some), error.with(Option::is_some)) {
                (_, true) => "Stopped at an error; it reloads when the files change".into(),
                (true, false) => format!("Loaded in {:.0} ms", loaded_in.get()),
                (false, false) => "Loading…".into(),
            }
        }))
        .child(div().flex_1())
        .child(item(move || {
            let Some(st) = stats.get() else {
                return String::new();
            };
            let ms = |d: std::time::Duration| d.as_secs_f64() * 1000.0;
            let mut s = format!(
                "Frame {} at {}×{}   script {:.2} ms   layout {:.2} ms   paint {:.2} ms",
                st.frame,
                st.size.0,
                st.size.1,
                ms(st.timings.script),
                ms(st.timings.layout),
                ms(st.timings.paint)
            );
            if !st.complete {
                s += "   decoding…";
            }
            s
        }))
}

/// Space plays and pauses, the arrows step a frame (a second with Shift), Home and End go to the
/// ends, + and - zoom the timeline.
fn keys(
    e: &KeyboardEvent,
    project: Signal<Option<Project>>,
    frame: Signal<u32>,
    playing: Signal<bool>,
    timeline: Timeline,
) {
    let Some(p) = project.get_untracked() else {
        return;
    };
    let last = p.info.duration_frames.saturating_sub(1);
    let step = if e.modifiers.shift {
        p.settings.fps.round() as u32
    } else {
        1
    };
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
        Key::Character(c) if c == "=" || c == "+" => timeline.zoom_by(2.0, None),
        Key::Character(c) if c == "-" => timeline.zoom_by(-2.0, None),
        _ => {}
    }
}

/// Moves the frame with the sound while `playing`, from where it is, around to the start at the
/// end: the frame is that of what is being heard (or of the time that went by, without sound). The
/// worker shows the latest frame it can: when it can't keep up, frames are skipped, not slowed
/// down.
fn play(
    project: Signal<Option<Project>>,
    frame: Signal<u32>,
    playing: Signal<bool>,
    player: Rc<AudioPlayer>,
) {
    let Some(p) = project.get_untracked() else {
        playing.set(false);
        return;
    };
    let total = p.info.duration_frames.max(1);
    let fps = p.settings.fps.max(1.0);
    let from = if frame.get_untracked() + 1 >= total {
        0
    } else {
        frame.get_untracked()
    };
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
