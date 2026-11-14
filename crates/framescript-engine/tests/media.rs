//! Videos in a composition: each frame shows its frame of the video, however it was reached, and
//! the preview shows what there is at once and hears when the right frame comes.
//!
//! The video is made with the ffmpeg command line: 3 s at 30 fps, 64×48, a key frame each second
//! and B-frames, with the luma of frame `n` at `16 + 2n`. Without ffmpeg, the tests are skipped.

use framescript_engine::render::OffscreenRenderer;
use framescript_engine::{Composition, Media, Wait};
use std::path::PathBuf;
use std::process::Command;
use std::sync::mpsc;
use std::time::Duration;

fn project(name: &str) -> Option<PathBuf> {
    let dir = std::env::temp_dir().join(format!("framescript-media-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let made = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-f", "lavfi", "-i"])
        .arg("color=black:s=64x48:r=30:d=3,format=yuv420p,geq=lum='16+N*2':cb=128:cr=128")
        .args(["-c:v", "libx264", "-qp", "4", "-g", "30", "-bf", "2", "-b_strategy", "0"])
        .args(["-pix_fmt", "yuv420p"])
        .arg(dir.join("counting.mp4"))
        .status();
    if !made.is_ok_and(|s| s.success()) {
        eprintln!("no ffmpeg to make a video with; skipped");
        return None;
    }
    std::fs::write(
        dir.join("framescript.json"),
        r#"{ "width": 64, "height": 48, "fps": 30, "entry": "main.tsx" }"#,
    )
    .unwrap();
    std::fs::write(
        dir.join("main.tsx"),
        r#"import { Clip, Video } from "framescript"
export default function Main() {
  return (
    <Clip label="video">
      <Video src="counting.mp4" style={{ width: "100%", height: "100%" }} />
    </Clip>
  )
}
"#,
    )
    .unwrap();
    Some(dir)
}

/// Which frame of the video shows, by the gray in the middle (limited range, BT.601).
fn number(rgba: &[u8]) -> i32 {
    let middle = (24 * 64 + 32) * 4;
    let gray = rgba[middle] as f64;
    (gray * 219.0 / 255.0 / 2.0).round() as i32
}

#[test]
fn the_clip_is_as_long_as_the_video() {
    let Some(dir) = project("length") else { return };
    let composition = Composition::load(&dir).expect("it loads");
    assert_eq!(composition.info().duration_frames, 90);
    assert_eq!(composition.info().clips[0].end, 90);
}

#[test]
fn each_frame_shows_its_frame_of_the_video_however_it_was_reached() {
    let Some(dir) = project("exact") else { return };
    let Ok(mut gpu) = OffscreenRenderer::new() else {
        eprintln!("no GPU to draw with; skipped");
        return;
    };
    let mut composition = Composition::load(&dir).expect("it loads");
    // Forward, back over key frames, within a group of pictures, far, and the ends.
    for frame in [0, 1, 2, 45, 44, 89, 30, 29, 31, 60, 3, 88, 0, 59, 61] {
        let (scene, _) = composition.render(frame).expect("it renders");
        assert_eq!(number(&gpu.rgba(&scene)), frame as i32, "frame {frame}");
    }
}

#[test]
fn the_preview_shows_what_there_is_and_hears_when_the_frame_comes() {
    let Some(dir) = project("preview") else { return };
    let Ok(mut gpu) = OffscreenRenderer::new() else {
        eprintln!("no GPU to draw with; skipped");
        return;
    };
    let media = Media::new();
    let (tx, rx) = mpsc::channel();
    media.set_listener(move || {
        let _ = tx.send(());
    });
    let mut composition = Composition::load_with(&dir, media.clone()).expect("it loads");
    let shown = composition.render_with(10, Wait::Exact).expect("it renders");
    assert!(shown.complete);
    assert_eq!(number(&gpu.rgba(&shown.scene)), 10);

    // Far from anything decoded, and not waiting at all: what was there shows.
    let r = composition.render_with(75, Wait::Upto(Duration::ZERO)).expect("it renders");
    assert!(!r.complete);
    assert!(number(&gpu.rgba(&r.scene)) < 75, "something decoded before shows");
    rx.recv_timeout(Duration::from_secs(10)).expect("it is told the frame came");
    let r = composition.render_with(75, Wait::Upto(Duration::ZERO)).expect("it renders");
    assert!(r.complete);
    assert_eq!(number(&gpu.rgba(&r.scene)), 75);

    // Loading again keeps what was decoded: the frame is there at once.
    drop(composition);
    let mut composition = Composition::load_with(&dir, media.clone()).expect("it loads");
    let r = composition.render_with(75, Wait::Upto(Duration::ZERO)).expect("it renders");
    assert!(r.complete, "the frames outlive the composition");
    assert_eq!(number(&gpu.rgba(&r.scene)), 75);
}
