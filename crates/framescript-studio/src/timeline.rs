//! The timeline: a ruler in seconds, the clips of the project in lanes, and the playhead. Pressing
//! or dragging anywhere on it seeks.
//!
//! It zooms from the whole project in the width it has down to a few frames, with Ctrl and the
//! wheel, a pinch or the controls of [`zoom_controls`], keeping the time under the pointer (or the
//! playhead) where it is. It scrolls both ways; the ruler stays on top.

use anti_webui::core::drag::GrabPhase;
use anti_webui::prelude::*;
use anti_webui_md3e::components::{
    ButtonSize, IconButtonStyle, SliderStyle, styled_icon_button, styled_slider, tooltip,
};
use anti_webui_md3e::{ColorScheme, color_scheme, icons};
use framescript_engine::ClipInfo;

use crate::studio::Project;

const RULER: f32 = 30.0;
const LANE: f32 = 30.0;
const LANE_GAP: f32 = 6.0;
/// Before the start and after the end of the project.
const PAD: f32 = 24.0;
/// Below the ruler and below the last lane.
const TOP: f32 = 10.0;
const BOTTOM: f32 = 16.0;
/// The most the timeline zooms in: logical pixels a frame.
const MOST_PER_FRAME: f32 = 48.0;
/// How much a notch of the wheel zooms.
const NOTCH: f32 = 1.25;

/// Where the timeline is looking. It is `Copy`: what it holds are signals.
#[derive(Clone, Copy)]
pub struct Timeline {
    project: Signal<Option<Project>>,
    frame: Signal<u32>,
    /// How many times closer than the whole project in the width there is, from 1.
    factor: Signal<f32>,
    /// The width of what scrolls, in logical pixels.
    view: Signal<(f32, f32)>,
    /// How far it has scrolled, in logical pixels.
    scroll: Signal<(f32, f32)>,
    scroller: NodeRef,
}

impl Timeline {
    pub fn new(project: Signal<Option<Project>>, frame: Signal<u32>) -> Self {
        Timeline {
            project,
            frame,
            factor: signal(1.0),
            view: signal((1.0, 1.0)),
            scroll: signal((0.0, 0.0)),
            scroller: node_ref(),
        }
    }

    fn loaded(&self) -> bool {
        self.project.with(Option::is_some)
    }

    fn frames(&self) -> u32 {
        self.project
            .with(|p| p.as_ref().map_or(1, |p| p.info.duration_frames.max(1)))
    }

    fn fps(&self) -> f64 {
        self.project
            .with(|p| p.as_ref().map_or(60.0, |p| p.settings.fps.max(1.0)))
    }

    /// Logical pixels a frame with the whole project in view.
    fn fit(&self) -> f32 {
        ((self.view.get().0 - 2.0 * PAD).max(40.0)) / self.frames() as f32
    }

    /// How many times closer it can get.
    fn most(&self) -> f32 {
        (MOST_PER_FRAME / self.fit()).max(1.0)
    }

    /// Logical pixels a frame.
    fn per_frame(&self) -> f32 {
        self.fit() * self.factor.get().clamp(1.0, self.most())
    }

    fn x_of(&self, frame: f32) -> f32 {
        PAD + frame * self.per_frame()
    }

    /// Zooms to `factor`, keeping what is at `anchor` (logical pixels from the left of the view)
    /// where it is: the playhead if that is in view, or the middle, without one.
    fn zoom_to(&self, factor: f32, anchor: Option<f32>) {
        let factor = factor.clamp(1.0, untrack(|| self.most()));
        let (old, (sx, sy), (vw, _)) =
            untrack(|| (self.per_frame(), self.scroll.get(), self.view.get()));
        let anchor = anchor.unwrap_or_else(|| {
            let x = untrack(|| self.x_of(self.frame.get() as f32)) - sx;
            if (0.0..=vw).contains(&x) { x } else { vw / 2.0 }
        });
        let at = (sx + anchor - PAD) / old;
        self.factor.set(factor);
        let new = untrack(|| self.per_frame());
        let x = (at * new + PAD - anchor).max(0.0);
        let scale = window_scale();
        self.scroller
            .scroll_to_after_layout(scale.px(x), scale.px(sy));
    }

    /// Closer by `steps` notches, or further with fewer than none.
    pub fn zoom_by(&self, steps: f32, anchor: Option<f32>) {
        let now = self.factor.get_untracked();
        self.zoom_to(now * NOTCH.powf(steps), anchor);
    }

    /// The whole project in view.
    pub fn fit_all(&self) {
        self.factor.set(1.0);
        self.scroller.scroll_to(0.0, self.scroll.get_untracked().1);
    }

    /// Scrolls so that the playhead is in view, if it isn't. Only the frame is tracked: zooming
    /// keeps what it keeps where it is.
    fn follow(&self) {
        let frame = self.frame.get() as f32;
        let (x, (sx, sy), (vw, _)) =
            untrack(|| (self.x_of(frame), self.scroll.get(), self.view.get()));
        if x < sx + 8.0 || x > sx + vw - 8.0 {
            self.scroller.scroll_to((x - PAD).max(0.0), sy);
        }
    }

    /// The timeline itself, as high as it is given.
    pub fn view(self) -> Div {
        let t = self;
        let frames = move || t.frames();
        let rows = move || {
            t.project.with(|p| {
                p.as_ref().map_or(1, |p| {
                    place(&p.info.clips)
                        .iter()
                        .map(|c| c.1 + 1)
                        .max()
                        .unwrap_or(1)
                })
            })
        };
        let content_h = move || RULER + TOP + rows() as f32 * (LANE + LANE_GAP) - LANE_GAP + BOTTOM;

        // Keeps the playhead in view as it plays or is moved with the keys.
        effect(move || t.follow());

        let lanes = dyn_view(move || {
            let n = rows();
            (0..n)
                .map(|row| {
                    div()
                        .absolute()
                        .left(0.0)
                        .right(0.0)
                        .top(lane_top(row))
                        .h(LANE)
                        .dyn_style(|s| s.bg(color_scheme().surface_container.with_alpha(0.6)))
                })
                .collect::<Vec<_>>()
        });

        let clips = dyn_view(move || {
            let Some(p) = t.project.get() else {
                return Vec::new();
            };
            place(&p.info.clips)
                .into_iter()
                .map(|(clip, row)| clip_view(t, clip, row))
                .collect::<Vec<_>>()
        });

        let playhead = div()
            .absolute()
            .top(0.0)
            .bottom(0.0)
            .w(2.0)
            .z_index(1)
            .pointer_events_none()
            .dyn_style(move |s| {
                let s = s
                    .left(t.x_of(t.frame.get() as f32) - 1.0)
                    .bg(color_scheme().primary);
                if t.loaded() { s } else { s.hidden() }
            });

        let content = div()
            .relative()
            .flex_none()
            .select_none()
            .min_h(pct(100.0))
            .dyn_style(move |s| s.w(t.x_of(frames() as f32) + PAD).h(content_h()))
            .grab_threshold(0.0)
            .on_grab(move |e| {
                if matches!(e.phase, GrabPhase::Start | GrabPhase::Move) {
                    let x = window_scale().to_logical(e.local.x);
                    let f = ((x - PAD) / t.per_frame()).round().max(0.0) as u32;
                    t.frame.set(f.min(frames().saturating_sub(1)));
                }
            })
            .child(lanes)
            .child(clips)
            .child(playhead)
            .child(ruler(t));

        div()
            .node_ref(t.scroller)
            .flex_1()
            .min_h(0.0)
            .overflow_scroll()
            .on_resized(move |w, h| t.view.set((w.max(1.0), h.max(1.0))))
            .on_scrolled(move |p| t.scroll.set((p.x, p.y)))
            .on_scroll(move |e| {
                if e.modifiers.ctrl {
                    let notches = -e.delta_y / (48.0 * window_scale().as_f64() as f32);
                    t.zoom_by(notches, hover_x());
                    e.stop_propagation();
                }
            })
            .on_pinch(move |e| {
                let x = window_scale().to_logical(e.local.x);
                t.zoom_to(t.factor.get_untracked() * e.scale, Some(x));
            })
            .on_pointer_move(move |e| set_hover_x(Some(window_scale().to_logical(e.local.x))))
            .on_hover(move |on| {
                if !on {
                    set_hover_x(None);
                }
            })
            .child(content)
    }
}

thread_local! {
    /// Where the pointer is over the timeline, from the left of what scrolls.
    static HOVER_X: std::cell::Cell<Option<f32>> = const { std::cell::Cell::new(None) };
}

fn hover_x() -> Option<f32> {
    HOVER_X.with(|h| h.get())
}

fn set_hover_x(x: Option<f32>) {
    HOVER_X.with(|h| h.set(x));
}

fn lane_top(row: usize) -> f32 {
    RULER + TOP + row as f32 * (LANE + LANE_GAP)
}

/// The colors of a clip, by how deep it is: its fill, its edge and its label.
fn clip_colors(depth: u32, c: &ColorScheme) -> (Color, Color, Color) {
    match depth % 3 {
        0 => (c.primary_container, c.primary, c.on_primary_container),
        1 => (c.tertiary_container, c.tertiary, c.on_tertiary_container),
        _ => (c.secondary_container, c.secondary, c.on_secondary_container),
    }
}

fn clip_view(t: Timeline, clip: &ClipInfo, row: usize) -> Div {
    let (start, end, depth) = (clip.start as f32, clip.end as f32, clip.depth);
    let label = clip
        .label
        .clone()
        .unwrap_or_else(|| format!("clip {}", clip.id));
    let length = clip.end - clip.start;
    div()
        .absolute()
        .top(lane_top(row))
        .h(LANE)
        .rounded(6.0)
        .border_l(3.0)
        .overflow_hidden()
        .pr(6.0)
        .flex()
        .flex_row()
        .items_center()
        .gap(6.0)
        .pointer_events_none()
        .dyn_style(move |s| {
            let (fill, edge, _) = clip_colors(depth, &color_scheme());
            let left = t.x_of(start);
            let width = (t.x_of(end) - left - 1.0).max(3.0);
            // The label stays in view while the start of the clip is scrolled out of it, as long
            // as there is room for it.
            let hidden = (t.scroll.get().0 - left).clamp(0.0, (width - 96.0).max(0.0));
            s.left(left)
                .pl(8.0 + hidden)
                .w(width)
                .bg(fill.with_alpha(0.55))
                .border_color(edge)
        })
        .child(
            text(label)
                .text_size(12.0)
                .font_weight(FontWeight(500))
                .whitespace_nowrap()
                .dyn_style(move |s| s.text_color(clip_colors(depth, &color_scheme()).2)),
        )
        .child(
            text(move || {
                let fps = t.fps();
                format!("{:.1} s", length as f64 / fps)
            })
            .text_size(11.0)
            .whitespace_nowrap()
            .dyn_style(move |s| {
                s.text_color(clip_colors(depth, &color_scheme()).2.with_alpha(0.7))
            }),
        )
}

/// Seconds between labels and the ticks between them, for this many logical pixels a second.
fn ruler_steps(per_second: f32, fps: f64) -> (f64, u32) {
    let frame = 1.0 / fps;
    let steps = [
        (frame, 1),
        (2.0 * frame, 2),
        (5.0 * frame, 5),
        (10.0 * frame, 10),
        (0.5, 5),
        (1.0, 4),
        (2.0, 4),
        (5.0, 5),
        (10.0, 5),
        (15.0, 3),
        (30.0, 6),
        (60.0, 4),
        (120.0, 4),
        (300.0, 5),
        (600.0, 10),
    ];
    steps
        .into_iter()
        .find(|(s, _)| *s as f32 * per_second >= 90.0)
        .unwrap_or((1200.0, 4))
}

/// The ruler, which stays at the top as the lanes scroll under it. Only the ticks around what is
/// in view are made.
fn ruler(t: Timeline) -> Div {
    // A stretch of the width at a time, so that scrolling makes them again only now and then.
    let stretch = memo(move || {
        let (sx, _) = t.scroll.get();
        let (vw, _) = t.view.get();
        (sx / vw.max(1.0)).floor() as i64
    });
    let ticks = dyn_view(move || {
        if !t.loaded() {
            return Vec::new();
        }
        let fps = t.fps();
        let per_frame = t.per_frame();
        let per_second = per_frame * fps as f32;
        let (major, minors) = ruler_steps(per_second, fps);
        let (vw, _) = t.view.get();
        let from = ((stretch.get() - 1) as f32 * vw).max(0.0);
        let to = (stretch.get() + 3) as f32 * vw;
        let end = t.frames() as f64 / fps;
        let minor = major / minors as f64;
        let first = (((from - PAD) / per_second) as f64 / minor)
            .floor()
            .max(0.0) as i64;
        let mut out = Vec::new();
        let mut i = first;
        loop {
            let seconds = i as f64 * minor;
            let x = PAD + seconds as f32 * per_second;
            if seconds > end + 1e-9 || x > to {
                break;
            }
            let labelled = i % minors as i64 == 0;
            let tick = div()
                .absolute()
                .left(x)
                .bottom(0.0)
                .w(1.0)
                .h(if labelled { 10.0 } else { 5.0 })
                .dyn_style(move |s| {
                    let c = color_scheme();
                    s.bg(if labelled {
                        c.outline
                    } else {
                        c.outline_variant
                    })
                });
            out.push(tick.into_view());
            if labelled {
                out.push(
                    text(ruler_label(seconds, major, fps))
                        .absolute()
                        .left(x + 4.0)
                        .top(5.0)
                        .text_size(11.0)
                        .whitespace_nowrap()
                        .dyn_style(|s| s.text_color(color_scheme().on_surface_variant))
                        .into_view(),
                );
            }
            i += 1;
        }
        out
    });
    let head = div()
        .absolute()
        .top(0.0)
        .w(12.0)
        .h(RULER)
        .pointer_events_none()
        .dyn_style(move |s| {
            let s = s.left(t.x_of(t.frame.get() as f32) - 6.0);
            if t.loaded() { s } else { s.hidden() }
        })
        .child(
            div()
                .absolute()
                .left(0.0)
                .bottom(0.0)
                .w(12.0)
                .h(14.0)
                .rounded_t(3.0)
                .rounded_b(6.0)
                .dyn_style(|s| s.bg(color_scheme().primary)),
        );
    div()
        .absolute()
        .left(0.0)
        .top(0.0)
        .w(pct(100.0))
        .h(RULER)
        .z_index(2)
        .border_b(1.0)
        .dyn_style(move |s| {
            let c = color_scheme();
            s.translate(0.0, t.scroll.get().1)
                .bg(c.surface_container_low)
                .border_color(c.outline_variant)
        })
        .child(ticks)
        .child(head)
}

/// What a label of the ruler says: minutes and seconds, and frames when the labels are closer
/// than a second.
fn ruler_label(seconds: f64, step: f64, fps: f64) -> String {
    let whole = (seconds + 1e-6).floor();
    let (m, s) = ((whole / 60.0) as u32, (whole % 60.0) as u32);
    if step >= 1.0 - 1e-9 {
        format!("{m}:{s:02}")
    } else {
        let f = ((seconds - whole) * fps).round() as u32;
        format!("{m}:{s:02}:{f:02}")
    }
}

/// Zooming out and in, a slider between, and the whole project in view.
pub fn zoom_controls(t: Timeline) -> Div {
    let level = Binding::new(
        move || {
            let most = t.most();
            if most <= 1.0 {
                0.0
            } else {
                t.factor.get().clamp(1.0, most).ln() / most.ln()
            }
        },
        move |v: f32| t.zoom_to(t.most().powf(v), None),
    );
    let small = || IconButtonStyle::standard().size(ButtonSize::ExtraSmall);
    div()
        .flex()
        .flex_row()
        .items_center()
        .gap(2.0)
        .child(tooltip(
            styled_icon_button(icons::ZOOM_OUT, small()).on_click(move |_| t.zoom_by(-2.0, None)),
            "Zoom out",
        ))
        .child(styled_slider(level, SliderStyle::new().no_stops()).w(110.0))
        .child(tooltip(
            styled_icon_button(icons::ZOOM_IN, small()).on_click(move |_| t.zoom_by(2.0, None)),
            "Zoom in (Ctrl + wheel)",
        ))
        .child(tooltip(
            styled_icon_button(icons::FIT_WIDTH, small()).on_click(move |_| t.fit_all()),
            "Whole project",
        ))
}

/// The rows of the clips: clips further in go below those around them, and clips at the same
/// depth that overlap go on rows of their own.
pub fn place(clips: &[ClipInfo]) -> Vec<(&ClipInfo, usize)> {
    let mut sorted: Vec<&ClipInfo> = clips.iter().collect();
    sorted.sort_by_key(|c| (c.depth, c.start, c.id));
    let mut out = Vec::with_capacity(sorted.len());
    let mut first_row = 0;
    let mut depth = None;
    // Where each row of the current depth is free from.
    let mut rows: Vec<u32> = Vec::new();
    for clip in sorted {
        if depth != Some(clip.depth) {
            first_row += rows.len();
            rows.clear();
            depth = Some(clip.depth);
        }
        let row = match rows.iter().position(|&end| end <= clip.start) {
            Some(r) => r,
            None => {
                rows.push(0);
                rows.len() - 1
            }
        };
        rows[row] = clip.end;
        out.push((clip, first_row + row));
    }
    out
}

/// `mm:ss:ff`.
pub fn timecode(frame: u32, fps: f64) -> String {
    let fps_whole = fps.round().max(1.0) as u32;
    let total_seconds = frame / fps_whole;
    format!(
        "{:02}:{:02}:{:02}",
        total_seconds / 60,
        total_seconds % 60,
        frame % fps_whole
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip(id: u32, start: u32, end: u32, depth: u32) -> ClipInfo {
        ClipInfo {
            id,
            label: None,
            start,
            end,
            depth,
            parent: None,
        }
    }

    #[test]
    fn overlapping_clips_get_rows_of_their_own() {
        let clips = [
            clip(1, 0, 10, 0),
            clip(2, 10, 20, 0),
            clip(3, 0, 30, 0),
            clip(4, 5, 8, 1),
        ];
        let rows: Vec<_> = place(&clips).into_iter().map(|(c, r)| (c.id, r)).collect();
        assert_eq!(rows, [(1, 0), (3, 1), (2, 0), (4, 2)]);
    }

    #[test]
    fn timecodes() {
        assert_eq!(timecode(0, 60.0), "00:00:00");
        assert_eq!(timecode(61, 60.0), "00:01:01");
        assert_eq!(timecode(60 * 60 + 30, 60.0), "01:00:30");
        assert_eq!(ruler_label(90.0, 5.0, 60.0), "1:30");
        assert_eq!(ruler_label(1.5, 0.5, 60.0), "0:01:30");
    }

    #[test]
    fn the_ruler_labels_are_far_enough_apart() {
        // The whole of 44 s in 1200 px, and close up.
        assert_eq!(ruler_steps(27.0, 60.0), (5.0, 5));
        let (step, _) = ruler_steps(60.0 * 40.0, 60.0);
        assert!(step < 0.1);
    }
}
