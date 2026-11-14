//! Writing a composition out: every frame once and in order whichever worker drew it, the sound
//! with it, a part of it, and cancelling.
//!
//! The project shows frame `f` as the gray `10 + 2f`, and plays `ramp.wav` (as in
//! `tests/sound.rs`: sample `n` is `(n % 1000) * 16 / 32768` on the left and `(n / 1000) * 16 /
//! 32768` on the right). The files are read back with the ffmpeg command line. Without it, or
//! without a GPU, the tests are skipped.

use framescript_engine::export::{Codec, Export, ExportSettings, Progress, Stage};
use framescript_engine::render::OffscreenRenderer;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;

const FPS: u32 = 30;
const FRAMES: u32 = 120;

fn ffmpeg(args: &[&str]) -> bool {
    Command::new("ffmpeg")
        .args(["-v", "error", "-y"])
        .args(args)
        .status()
        .is_ok_and(|s| s.success())
}

fn project(name: &str) -> Option<PathBuf> {
    if let Err(e) = OffscreenRenderer::new() {
        eprintln!("no GPU ({e}); skipped");
        return None;
    }
    let dir = std::env::temp_dir().join(format!("framescript-export-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let made = ffmpeg(&[
        "-f",
        "lavfi",
        "-i",
        "aevalsrc=exprs='mod(n\\,1000)*16/32768|floor(n/1000)*16/32768':s=48000:d=3",
        "-c:a",
        "pcm_s16le",
        dir.join("ramp.wav").to_str().unwrap(),
    ]);
    if !made {
        eprintln!("no ffmpeg; skipped");
        return None;
    }
    std::fs::write(
        dir.join("framescript.json"),
        format!(
            r#"{{ "width": 64, "height": 48, "fps": {FPS}, "entry": "main.tsx", "duration": {} }}"#,
            FRAMES / FPS
        ),
    )
    .unwrap();
    std::fs::write(
        dir.join("main.tsx"),
        r#"import { Audio, FillFrame, useCurrentFrame } from "framescript"
export default function Main() {
  const frame = useCurrentFrame()
  const gray = () => 10 + 2 * frame()
  return (
    <FillFrame style={{ background: () => `rgb(${gray()}, ${gray()}, ${gray()})` }}>
      <Audio src="ramp.wav" />
    </FillFrame>
  )
}
"#,
    )
    .unwrap();
    Some(dir)
}

/// Exports, and what it said last.
fn export(dir: &Path, settings: ExportSettings) -> Progress {
    let (send, receive) = mpsc::channel();
    let job = Export::start(dir.to_path_buf(), settings, move |p| {
        let _ = send.send(p);
    });
    let last = receive.iter().last().expect("it says how it went");
    job.wait();
    last
}

/// The luma of the middle of every frame of `file`, as it is in the file (video range).
fn lumas(file: &Path) -> Vec<u8> {
    let out = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(file)
        .args(["-f", "rawvideo", "-pix_fmt", "yuv420p", "-"])
        .output()
        .unwrap();
    out.stdout.chunks_exact(64 * 48 * 3 / 2).map(|f| f[24 * 64 + 32]).collect()
}

/// The luma that frame `f` is written as: BT.709 in video range.
fn luma_of(f: u32) -> u8 {
    let gray = (10 + 2 * f) as f64 / 255.0;
    (16.0 + 219.0 * gray).round() as u8
}

/// The sound of `file`, as pairs of 16 bits.
fn sound(file: &Path) -> Vec<i16> {
    let out = Command::new("ffmpeg")
        .args(["-v", "error", "-i"])
        .arg(file)
        .args(["-f", "s16le", "-ac", "2", "-ar", "48000", "-"])
        .output()
        .unwrap();
    out.stdout.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect()
}

fn duration(file: &Path, stream: &str) -> f64 {
    let out = Command::new("ffprobe")
        .args(["-v", "error", "-select_streams", stream, "-show_entries", "stream=duration"])
        .args(["-of", "csv=p=0"])
        .arg(file)
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).trim().parse().unwrap()
}

#[test]
fn every_frame_is_there_once_and_in_order_whoever_drew_it() {
    let Some(dir) = project("order") else { return };
    let out = dir.join("out").join("order.mp4");
    let mut settings = ExportSettings::new(out.clone(), Codec::H264);
    // Lossless, so that the grays can be read back exactly.
    settings.quality = 0;
    settings.workers = 3;
    let p = export(&dir, settings);
    assert_eq!(p.stage, Stage::Done, "{p:?}");
    assert_eq!((p.done, p.total), (FRAMES, FRAMES));

    let lumas = lumas(&out);
    assert_eq!(lumas.len(), FRAMES as usize);
    for (f, &l) in lumas.iter().enumerate() {
        assert_eq!(l, luma_of(f as u32), "frame {f}");
    }
    assert!((duration(&out, "v") - 4.0).abs() < 1e-3);
    assert!((duration(&out, "a") - 4.0).abs() < 0.03);
    // Nothing is left of the pieces.
    let left: Vec<_> = std::fs::read_dir(dir.join("out")).unwrap().flatten().map(|e| e.file_name()).collect();
    assert_eq!(left, ["order.mp4"]);
}

#[test]
fn the_sound_is_the_mix_sample_for_sample() {
    let Some(dir) = project("sound") else { return };
    let out = dir.join("sound.mov");
    let mut settings = ExportSettings::new(out.clone(), Codec::ProRes);
    settings.workers = 2;
    let p = export(&dir, settings);
    assert_eq!(p.stage, Stage::Done, "{p:?}");

    let samples = sound(&out);
    assert_eq!(samples.len(), 4 * 48000 * 2);
    for (n, pair) in samples.chunks_exact(2).enumerate() {
        let expected = if n < 3 * 48000 {
            [(n % 1000) as i16 * 16, (n / 1000) as i16 * 16]
        } else {
            [0, 0]
        };
        assert_eq!(pair, expected, "at {n}");
    }
    // ProRes is drawn as RGBA and converted by FFmpeg: close, if not exact.
    let lumas = lumas(&out);
    assert_eq!(lumas.len(), FRAMES as usize);
    for (f, &l) in lumas.iter().enumerate() {
        assert!(l.abs_diff(luma_of(f as u32)) <= 1, "frame {f}: {l}");
    }
}

#[test]
fn a_part_of_it_starts_where_it_says() {
    let Some(dir) = project("part") else { return };
    let out = dir.join("part.mp4");
    let mut settings = ExportSettings::new(out.clone(), Codec::H264);
    settings.quality = 0;
    settings.workers = 2;
    settings.range = Some((30, 75));
    let p = export(&dir, settings);
    assert_eq!(p.stage, Stage::Done, "{p:?}");
    assert_eq!(p.total, 45);

    let lumas = lumas(&out);
    assert_eq!(lumas.len(), 45);
    for (i, &l) in lumas.iter().enumerate() {
        let f = 30 + i as u32;
        assert!(l.abs_diff(luma_of(f)) <= 1, "frame {f}: {l}");
    }
    assert!((duration(&out, "a") - 1.5).abs() < 0.03);
}

#[test]
fn cancelling_leaves_nothing() {
    let Some(dir) = project("cancel") else { return };
    let out = dir.join("out").join("cancelled.mp4");
    let (send, receive) = mpsc::channel();
    let job = Export::start(dir.clone(), ExportSettings::new(out.clone(), Codec::H264), move |p| {
        let _ = send.send(p);
    });
    job.cancel();
    let last = receive.iter().last().unwrap();
    job.wait();
    assert_eq!(last.stage, Stage::Cancelled);
    assert!(!out.exists());
    let left = std::fs::read_dir(dir.join("out")).map_or(0, |d| d.count());
    assert_eq!(left, 0);
}
