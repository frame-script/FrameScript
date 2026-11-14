//! The export window: where and how to write the video out, and how far that has got.
//!
//! The export runs on threads of its own (see `framescript_engine::export`), from the files of the
//! project as they are when it starts, and the studio goes on as before meanwhile. What it says
//! comes back through a channel of the studio's window, so the export window can be closed and
//! opened again while it runs.

use crate::studio::Project;
use crate::timeline::timecode;
use anti_webui::prelude::*;
use anti_webui_md3e::components::{
    ButtonStyle, SliderStyle, TextFieldStyle, connected_button_group, dropdown_field,
    linear_progress, outlined_button, outlined_text_field, sized_icon, styled_button,
    styled_slider, switch,
};
use anti_webui_md3e::{color_scheme, icons};
use framescript_engine::export::{self, Codec, Export, ExportSettings, Progress, Speed, Stage};
use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::Rc;

/// Of the project's size.
const SCALES: [(f64, &str); 4] = [(0.5, "50%"), (1.0, "100%"), (1.5, "150%"), (2.0, "200%")];
/// Of the sound, in kb/s.
const BITRATES: [u32; 4] = [128, 192, 256, 320];
const LABEL: f32 = 92.0;

/// What the form says.
#[derive(Clone, Copy)]
struct Form {
    output: Signal<String>,
    codec: Signal<Codec>,
    quality: Signal<f32>,
    speed: Signal<Speed>,
    scale: Signal<f64>,
    whole: Signal<bool>,
    from: Signal<String>,
    to: Signal<String>,
    workers: Signal<f32>,
    audio: Signal<bool>,
    bitrate: Signal<u32>,
}

pub struct Exporter {
    dir: PathBuf,
    project: Signal<Option<Project>>,
    form: Form,
    /// Of the export going on, or of the last one.
    pub progress: Signal<Option<Progress>>,
    /// What the system's FFmpeg can encode, once it has been asked.
    codecs: Signal<Option<Result<Vec<Codec>, String>>>,
    /// Why the form can't be exported as it is.
    problem: Signal<Option<String>>,
    job: Rc<RefCell<Option<Export>>>,
    window: RefCell<Option<WindowHandle>>,
    sender: UiSender<Progress>,
}

impl Exporter {
    /// Made in the studio's window, whose channel the export reports through.
    pub fn new(dir: PathBuf, project: Signal<Option<Project>>) -> Rc<Exporter> {
        let form = Form {
            output: signal(String::new()),
            codec: signal(Codec::H264),
            quality: signal(Codec::H264.default_quality() as f32),
            speed: signal(Speed::Medium),
            scale: signal(1.0),
            whole: signal(true),
            from: signal(String::new()),
            to: signal(String::new()),
            workers: signal(export::default_workers() as f32),
            audio: signal(true),
            bitrate: signal(192),
        };
        let progress = signal(None::<Progress>);
        let job = Rc::new(RefCell::new(None::<Export>));
        let sender = ui_channel({
            let job = job.clone();
            move |p: Progress| {
                if p.stage.is_over() {
                    // Its thread is on the way out.
                    job.borrow_mut().take();
                    match &p.stage {
                        Stage::Done => eprintln!("framescript: wrote {}", p.output.display()),
                        Stage::Failed(e) => eprintln!("framescript: the export failed: {e}"),
                        _ => {}
                    }
                }
                progress.set(Some(p));
            }
        });

        let codecs = signal(None);
        let found = ui_channel(move |c| codecs.set(Some(c)));
        std::thread::spawn(move || found.send(export::available_codecs()));

        // A name from the project, and the frames all of it has, until they are changed.
        effect({
            let dir = dir.clone();
            move || {
                let Some(p) = project.get() else {
                    return;
                };
                if form.output.get_untracked().is_empty() {
                    let name = format!(
                        "{}.{}",
                        p.settings.name,
                        form.codec.get_untracked().extension()
                    );
                    form.output
                        .set(dir.join("out").join(name).to_string_lossy().into_owned());
                }
                if form.whole.get_untracked() {
                    form.from.set("0".into());
                    form.to.set(p.info.duration_frames.to_string());
                }
            }
        });
        // The file goes with the codec.
        effect(move || {
            let codec = form.codec.get();
            let output = form.output.get_untracked();
            if !output.is_empty() {
                let path = Path::new(&output).with_extension(codec.extension());
                form.output.set(path.to_string_lossy().into_owned());
            }
            form.quality.set(codec.default_quality() as f32);
        });

        Rc::new(Exporter {
            dir,
            project,
            form,
            progress,
            codecs,
            problem: signal(None),
            job,
            window: RefCell::new(None),
            sender,
        })
    }

    pub fn running(&self) -> bool {
        self.progress
            .with(|p| p.as_ref().is_some_and(|p| !p.stage.is_over()))
    }

    /// Opens the window, unless it is open.
    pub fn open(self: &Rc<Self>) {
        if self.window.borrow().as_ref().is_some_and(|w| w.is_open()) {
            return;
        }
        let this = self.clone();
        let window = open_window(
            WindowOptions::new()
                .title("Export")
                .size(560, 720)
                .dialog(true)
                .background(color_scheme().surface_container_low),
            move || view(this),
        );
        *self.window.borrow_mut() = Some(window);
    }

    /// Stops the export, if there is one, and deletes what it wrote.
    pub fn cancel(&self) {
        if let Some(job) = self.job.borrow().as_ref() {
            job.cancel();
        }
    }

    /// Cancels the export and waits for it to stop: when the studio closes.
    pub fn stop(&self) {
        let job = self.job.borrow_mut().take();
        drop(job);
    }


    fn start(&self) {
        if self.running() {
            return;
        }
        let f = self.form;
        let output = f.output.get_untracked();
        if output.trim().is_empty() {
            self.problem.set(Some("Say where the video goes.".into()));
            return;
        }
        let mut settings =
            ExportSettings::new(PathBuf::from(output.trim()), f.codec.get_untracked());
        settings.quality = f.quality.get_untracked().round() as u32;
        settings.speed = f.speed.get_untracked();
        settings.scale = f.scale.get_untracked();
        settings.workers = (f.workers.get_untracked().round() as usize).max(1);
        settings.audio = f.audio.get_untracked().then(|| f.bitrate.get_untracked());
        if !f.whole.get_untracked() {
            let frame = |s: Signal<String>| s.get_untracked().trim().parse::<u32>().ok();
            match (frame(f.from), frame(f.to)) {
                (Some(from), Some(to)) if from < to => settings.range = Some((from, to)),
                _ => {
                    self.problem.set(Some(
                        "The frames are a first frame and a later one to stop before.".into(),
                    ));
                    return;
                }
            }
        }
        self.problem.set(None);
        let sender = self.sender.clone();
        let job = Export::start(self.dir.clone(), settings.clone(), move |p| sender.send(p));
        *self.job.borrow_mut() = Some(job);
        self.progress.set(Some(Progress {
            stage: Stage::Starting,
            done: 0,
            total: 0,
            elapsed: Default::default(),
            rate: 0.0,
            size: (0, 0),
            output: settings.output,
        }));
    }
}

/// A line of the form: what it is, and what sets it.
fn row(label: &str, content: impl IntoView) -> Div {
    div()
        .flex()
        .flex_row()
        .items_center()
        .gap(12.0)
        .min_h(48.0)
        .child(
            text(label.to_string())
                .w(LABEL)
                .flex_none()
                .text_size(14.0)
                .text_color(color_scheme().on_surface_variant),
        )
        .child(
            div()
                .flex()
                .flex_row()
                .items_center()
                .gap(12.0)
                .flex_1()
                .min_w(0.0)
                .child(content),
        )
}

fn note(f: impl Fn() -> String + 'static) -> Text {
    text(f)
        .text_size(13.0)
        .text_color(color_scheme().on_surface_variant)
}

fn view(this: Rc<Exporter>) -> impl IntoView {
    let f = this.form;
    let project = this.project;
    let codecs = this.codecs;
    let idle = {
        let this = this.clone();
        move || !this.running()
    };

    let codec_row = dyn_view(move || match codecs.get() {
        None => note(|| "Asking FFmpeg what it can encode…".into()).into_view(),
        Some(Err(e)) => note(move || e.clone())
            .text_color(color_scheme().error)
            .into_view(),
        Some(Ok(list)) => {
            let label = signal(f.codec.get_untracked().label().to_string());
            let options = list.iter().map(|c| c.label().to_string()).collect();
            effect(move || {
                let chosen = label.get();
                if let Some(c) = Codec::ALL.into_iter().find(|c| c.label() == chosen) {
                    f.codec.set(c);
                }
            });
            dropdown_field(label, options, TextFieldStyle::new(), true)
                .w(320.0)
                .into_view()
        }
    });

    let quality_row = dyn_view(move || {
        let codec = f.codec.get();
        let Some((lo, hi)) = codec.quality_range() else {
            return note(|| "ProRes 422 HQ has one quality: as good as it gets, and large.".into())
                .into_view();
        };
        div()
            .flex()
            .flex_row()
            .items_center()
            .gap(12.0)
            .child(
                styled_slider(
                    f.quality,
                    SliderStyle::new()
                        .range(lo as f32..=hi as f32)
                        .label(|v| format!("{v:.0}")),
                )
                .w(220.0),
            )
            .child(note(move || {
                let q = f.quality.get().round();
                let what = if codec.is_hardware() { "QP" } else { "CRF" };
                format!("{what} {q:.0}: lower is better, and larger")
            }))
            .into_view()
    });

    let speed_row = dyn_view(move || {
        let codec = f.codec.get();
        if codec.is_hardware() || codec == Codec::ProRes {
            return note(|| "Set by the encoder.".into()).into_view();
        }
        connected_button_group(
            ["Fast", "Medium", "Slow"],
            ButtonStyle::tonal(),
            move |i| f.speed.get() == Speed::ALL[i],
            move |i| f.speed.set(Speed::ALL[i]),
        )
        .child(note(|| "slower makes smaller files".into()).ml(8.0))
        .into_view()
    });

    let size_row = connected_button_group(
        SCALES.map(|(_, l)| l),
        ButtonStyle::tonal(),
        move |i| f.scale.get() == SCALES[i].0,
        move |i| f.scale.set(SCALES[i].0),
    )
    .child(
        note(move || {
            let scale = f.scale.get();
            project.with(|p| match p {
                Some(p) => {
                    let side = |n: u32| ((n as f64 * scale).round() as u32).div_ceil(2) * 2;
                    format!("{} × {}", side(p.settings.width), side(p.settings.height))
                }
                None => String::new(),
            })
        })
        .ml(8.0),
    );

    let frames_row = div()
        .flex()
        .flex_row()
        .items_center()
        .gap(12.0)
        .child(connected_button_group(
            ["All", "Some"],
            ButtonStyle::tonal(),
            move |i| f.whole.get() == (i == 0),
            move |i| {
                f.whole.set(i == 0);
                if i == 0 {
                    let total = project
                        .with_untracked(|p| p.as_ref().map_or(0, |p| p.info.duration_frames));
                    f.from.set("0".into());
                    f.to.set(total.to_string());
                }
            },
        ))
        .child(dyn_view(move || {
            if f.whole.get() {
                return note(move || {
                    project.with(|p| match p {
                        Some(p) => format!(
                            "{} frames, {}",
                            p.info.duration_frames,
                            timecode(p.info.duration_frames, p.settings.fps)
                        ),
                        None => String::new(),
                    })
                })
                .into_view();
            }
            div()
                .flex()
                .flex_row()
                .items_center()
                .gap(8.0)
                .child(
                    outlined_text_field(f.from, TextFieldStyle::new().label("From frame")).w(120.0),
                )
                .child(
                    outlined_text_field(f.to, TextFieldStyle::new().label("Up to frame")).w(120.0),
                )
                .into_view()
        }));

    let sound_row = div()
        .flex()
        .flex_row()
        .items_center()
        .gap(12.0)
        .child(switch(f.audio))
        .child(dyn_view(move || {
            if !f.audio.get() {
                return note(|| "No sound".into()).into_view();
            }
            if f.codec.get() == Codec::ProRes {
                return note(|| "As it is (PCM)".into()).into_view();
            }
            let label = signal(format!("{} kb/s", f.bitrate.get_untracked()));
            effect(move || {
                let chosen = label.get();
                if let Some(&b) = BITRATES.iter().find(|b| format!("{b} kb/s") == chosen) {
                    f.bitrate.set(b);
                }
            });
            let options = BITRATES.iter().map(|b| format!("{b} kb/s")).collect();
            dropdown_field(label, options, TextFieldStyle::new().label("AAC"), true)
                .w(160.0)
                .into_view()
        }));

    let threads = std::thread::available_parallelism()
        .map_or(4, |n| n.get())
        .clamp(2, 16);
    let workers_row = div()
        .flex()
        .flex_row()
        .items_center()
        .gap(12.0)
        .child(
            styled_slider(
                f.workers,
                SliderStyle::new()
                    .range(1.0..=threads as f32)
                    .steps(threads as u32 - 1)
                    .label(|v| format!("{v:.0}")),
            )
            .w(220.0),
        )
        .child(note(move || {
            let n = f.workers.get().round() as u32;
            format!("{n} frame{} drawn at once", if n == 1 { "" } else { "s" })
        }));

    let form = div()
        .flex()
        .flex_col()
        .gap(10.0)
        .child(row(
            "File",
            outlined_text_field(
                f.output,
                TextFieldStyle::new().label("Where the video goes"),
            )
            .flex_1(),
        ))
        .child(row("Format", codec_row))
        .child(row("Quality", quality_row))
        .child(row("Speed", speed_row))
        .child(row("Size", size_row))
        .child(row("Frames", frames_row))
        .child(row("Sound", sound_row))
        .child(row("Workers", workers_row));

    let actions = {
        let start = this.clone();
        let cancel = this.clone();
        let running = this.clone();
        div()
            .flex()
            .flex_row()
            .justify_end()
            .gap(12.0)
            .child(dyn_view(move || {
                if running.running() {
                    let cancel = cancel.clone();
                    outlined_button("Cancel")
                        .on_click(move |_| cancel.cancel())
                        .into_view()
                } else {
                    let close = || close_window();
                    outlined_button("Close")
                        .on_click(move |_| close())
                        .into_view()
                }
            }))
            .child({
                let ready = Rc::new(move || {
                    idle() && matches!(codecs.get(), Some(Ok(_))) && project.with(|p| p.is_some())
                });
                let not_ready = ready.clone();
                styled_button(
                    "Export",
                    ButtonStyle::filled().disabled_when(move || !not_ready()),
                )
                .on_click(move |_| {
                    if ready() {
                        start.start();
                    }
                })
            })
    };

    div()
        .size_full()
        .flex()
        .flex_col()
        .gap(16.0)
        .p(24.0)
        .bg(color_scheme().surface_container_low)
        .text_color(color_scheme().on_surface)
        .child(
            div()
                .flex()
                .flex_row()
                .items_center()
                .gap(12.0)
                .child(sized_icon(icons::MOVIE, 28.0))
                .child(text("Export").text_size(24.0)),
        )
        .child(form)
        .child(div().flex_1())
        .child(status(this.clone()))
        .child(actions)
}

/// How the export goes, or how it went.
fn status(this: Rc<Exporter>) -> impl IntoView {
    let progress = this.progress;
    let problem = this.problem;
    dyn_view(move || {
        if let Some(p) = problem.get() {
            return note(move || p.clone())
                .text_color(color_scheme().error)
                .into_view();
        }
        let Some(p) = progress.get() else {
            return div().into_view();
        };
        let done = p.done as f32 / p.total.max(1) as f32;
        let (line, icon, color) = describe(&p);
        let bar = match p.stage {
            Stage::Starting | Stage::Rendering | Stage::Joining => {
                Some(linear_progress(move || done).w_full())
            }
            _ => None,
        };
        div()
            .flex()
            .flex_col()
            .gap(10.0)
            .children(bar)
            .child(
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap(8.0)
                    .children(icon.map(|i| sized_icon(i, 20.0).text_color(color)))
                    .child(text(line).text_size(14.0).text_color(color)),
            )
            .into_view()
    })
}

/// A line about `p`, an icon for the end, and its color.
fn describe(p: &Progress) -> (String, Option<&'static icons::Symbol>, Color) {
    let c = color_scheme();
    let seconds = p.elapsed.as_secs_f64();
    let rate = p.done as f64 / seconds.max(1e-3);
    match &p.stage {
        Stage::Starting => ("Loading the project…".into(), None, c.on_surface_variant),
        Stage::Rendering => {
            let rate = if p.rate > 0.0 {
                let left = (p.total - p.done.min(p.total)) as f64 / p.rate;
                format!(": {:.0} a second, about {left:.0} s left", p.rate)
            } else {
                String::new()
            };
            (
                format!(
                    "Drawing frame {} of {} at {}×{}{rate}",
                    p.done, p.total, p.size.0, p.size.1
                ),
                None,
                c.on_surface_variant,
            )
        }
        Stage::Joining => (
            "Putting the pieces and the sound together…".into(),
            None,
            c.on_surface_variant,
        ),
        Stage::Done => (
            format!(
                "Wrote {} in {seconds:.1} s ({:.0} frames a second)",
                p.output.display(),
                rate
            ),
            Some(icons::CHECK_CIRCLE),
            c.primary,
        ),
        Stage::Failed(e) => (format!("It failed: {e}"), Some(icons::ERROR), c.error),
        Stage::Cancelled => (
            "Cancelled; what was written is gone.".into(),
            None,
            c.on_surface_variant,
        ),
    }
}

/// For the transport: how far the export has got, if one is going on.
pub fn summary(this: &Rc<Exporter>) -> Option<String> {
    let p = this.progress.get()?;
    match p.stage {
        Stage::Starting => Some("exporting…".into()),
        Stage::Rendering => Some(format!(
            "exporting {:.0}%",
            p.done as f64 * 100.0 / p.total.max(1) as f64
        )),
        Stage::Joining => Some("exporting: joining…".into()),
        _ => None,
    }
}
