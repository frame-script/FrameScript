//! The timeline: a ruler in seconds, the clips of the project in lanes, and the playhead. Pressing
//! or dragging anywhere on it seeks.

use anti_webui::core::drag::GrabPhase;
use anti_webui::prelude::*;
use framescript_engine::ClipInfo;

use crate::studio::Project;

const RULER: f32 = 26.0;
const LANE: f32 = 26.0;
const LANE_GAP: f32 = 4.0;
const SIDE: f32 = 12.0;

/// Colors of the clips, by how deep they are.
const CLIP_COLORS: [u32; 4] = [0x3b82f6, 0x8b5cf6, 0x14b8a6, 0xf59e0b];

pub fn timeline(project: Signal<Option<Project>>, frame: Signal<u32>) -> Div {
    // The width of the track in logical pixels, where frames map to.
    let width = signal(1.0f32);
    let duration = move || project.with(|p| p.as_ref().map_or(1, |p| p.info.duration_frames.max(1)));
    let fps = move || project.with(|p| p.as_ref().map_or(60.0, |p| p.settings.fps));
    let x_of = move |f: u32| f as f32 / duration() as f32 * width.get();

    let seek_to = move |local_x: f32, box_width: f32| {
        let fraction = (local_x / box_width.max(1.0)).clamp(0.0, 1.0);
        let last = duration().saturating_sub(1);
        frame.set(((fraction * duration() as f32) as u32).min(last));
    };

    let ruler = dyn_view(move || {
        let (duration, fps, width) = (duration(), fps(), width.get());
        let px_per_second = width / (duration as f32 / fps as f32);
        // Seconds between labels, so that they are at least 70 px apart.
        let step = [0.5f32, 1.0, 2.0, 5.0, 10.0, 15.0, 30.0, 60.0, 120.0, 300.0]
            .into_iter()
            .find(|s| s * px_per_second >= 70.0)
            .unwrap_or(600.0);
        let mut ticks = Vec::new();
        let mut t = 0.0f32;
        while t * fps as f32 <= duration as f32 {
            let x = t * px_per_second;
            ticks.push(
                div()
                    .absolute()
                    .left(x)
                    .top(0.0)
                    .h(RULER)
                    .border_l(1.0)
                    .border_color(Color::from_rgba(0xffffff30))
                    .pl(4.0)
                    .child(
                        text(timecode_seconds(t))
                            .text_size(11.0)
                            .text_color(Color::from_rgb(0x8b93a7))
                            .whitespace_nowrap(),
                    ),
            );
            t += step;
        }
        ticks
    });

    let lanes = dyn_view(move || {
        let Some(p) = project.get() else {
            return Vec::new();
        };
        let width = width.get();
        let duration = p.info.duration_frames.max(1) as f32;
        let placed = place(&p.info.clips);
        placed
            .into_iter()
            .map(|(clip, row)| {
                let left = clip.start as f32 / duration * width;
                let w = ((clip.end - clip.start) as f32 / duration * width).max(2.0);
                let color = CLIP_COLORS[clip.depth as usize % CLIP_COLORS.len()];
                let label = clip.label.clone().unwrap_or_else(|| format!("clip {}", clip.id));
                div()
                    .absolute()
                    .left(left)
                    .top(RULER + LANE_GAP + row as f32 * (LANE + LANE_GAP))
                    .w(w)
                    .h(LANE)
                    .rounded(5.0)
                    .bg(Color::from_rgba((color << 8) | 0x66))
                    .border(1.0)
                    .border_color(Color::from_rgba((color << 8) | 0xcc))
                    .overflow_hidden()
                    .px(6.0)
                    .flex()
                    .items_center()
                    .pointer_events_none()
                    .child(
                        text(label)
                            .text_size(12.0)
                            .text_color(Color::from_rgb(0xe5e7eb))
                            .whitespace_nowrap(),
                    )
            })
            .collect::<Vec<_>>()
    });

    let rows = move || {
        project.with(|p| p.as_ref().map_or(1, |p| place(&p.info.clips).iter().map(|c| c.1 + 1).max().unwrap_or(1)))
    };

    let playhead = div()
        .absolute()
        .top(0.0)
        .w(2.0)
        .h(pct(100.0))
        .bg(Color::from_rgb(0xf43f5e))
        .pointer_events_none()
        .dyn_style(move |s| s.left(x_of(frame.get()) - 1.0))
        .child(
            div()
                .absolute()
                .top(0.0)
                .left(-5.0)
                .w(12.0)
                .h(10.0)
                .rounded_b(4.0)
                .bg(Color::from_rgb(0xf43f5e)),
        );

    let track = div()
        .relative()
        .flex_1()
        .dyn_style(move |s| s.h(RULER + LANE_GAP + rows() as f32 * (LANE + LANE_GAP) + 8.0))
        .select_none()
        .on_resized(move |w, _| width.set(w.max(1.0)))
        .grab_threshold(0.0)
        .on_grab(move |e| {
            if matches!(e.phase, GrabPhase::Start | GrabPhase::Move) {
                seek_to(e.local.x, e.rect.width as f32);
            }
        })
        .child(
            div()
                .absolute()
                .left(0.0)
                .top(0.0)
                .w(pct(100.0))
                .h(RULER)
                .bg(Color::from_rgb(0x1b1e27))
                .child(ruler),
        )
        .child(lanes)
        .child(playhead);

    div()
        .flex()
        .flex_col()
        .px(SIDE)
        .pb(8.0)
        .bg(Color::from_rgb(0x12141b))
        .child(track)
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

fn timecode_seconds(t: f32) -> String {
    let t = t.max(0.0);
    let m = (t / 60.0) as u32;
    let s = t - m as f32 * 60.0;
    if s.fract() == 0.0 {
        format!("{m}:{:02}", s as u32)
    } else {
        format!("{m}:{s:04.1}")
    }
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
        let clips = [clip(1, 0, 10, 0), clip(2, 10, 20, 0), clip(3, 0, 30, 0), clip(4, 5, 8, 1)];
        let rows: Vec<_> = place(&clips).into_iter().map(|(c, r)| (c.id, r)).collect();
        assert_eq!(rows, [(1, 0), (3, 1), (2, 0), (4, 2)]);
    }

    #[test]
    fn timecodes() {
        assert_eq!(timecode(0, 60.0), "00:00:00");
        assert_eq!(timecode(61, 60.0), "00:01:01");
        assert_eq!(timecode(60 * 60 + 30, 60.0), "01:00:30");
        assert_eq!(timecode_seconds(90.0), "1:30");
    }
}
