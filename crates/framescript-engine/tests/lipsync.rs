//! Mouths that move with what is said: how loud a file is over time, and `<LipSync>`.
//!
//! `voice.wav` is made with the ffmpeg command line: 3 s at 48 kHz in two channels, silent but
//! for a tone from 1 s to 2 s at half of full scale (at 200 Hz, two waves to each hundredth of a
//! second). The mouths are a white picture (open) and a black one (closed).
//! Without ffmpeg, the tests are skipped.

use framescript_engine::Composition;
use framescript_engine::render::OffscreenRenderer;
use framescript_engine::sound::{AudioSource, LEVELS_PER_SECOND};
use std::path::PathBuf;
use std::process::Command;

fn ffmpeg(args: &[&str]) -> bool {
    Command::new("ffmpeg")
        .args(["-v", "error", "-y"])
        .args(args)
        .status()
        .is_ok_and(|s| s.success())
}

fn project(name: &str, main: &str) -> Option<PathBuf> {
    let dir = std::env::temp_dir().join(format!("framescript-lipsync-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = |file: &str| dir.join(file).to_str().unwrap().to_string();
    let tone = "if(between(t\\,1\\,2)\\,0.5*sin(2*PI*200*t)\\,0)";
    let made = ffmpeg(&[
        "-f",
        "lavfi",
        "-i",
        &format!("aevalsrc=exprs='{tone}|{tone}':s=48000:d=3"),
        "-c:a",
        "pcm_s16le",
        &path("voice.wav"),
    ]) && ["white", "black"].iter().zip(["open.png", "closed.png"]).all(|(color, file)| {
        ffmpeg(&["-f", "lavfi", "-i", &format!("color={color}:s=8x8"), "-frames:v", "1", &path(file)])
    });
    if !made {
        eprintln!("no ffmpeg to make sound with; skipped");
        return None;
    }
    std::fs::write(
        dir.join("framescript.json"),
        r#"{ "width": 64, "height": 48, "fps": 30, "entry": "main.tsx" }"#,
    )
    .unwrap();
    std::fs::write(dir.join("main.tsx"), main).unwrap();
    Some(dir)
}

/// The mouth comes before the clips it follows. Another voice is heard first; then the first line
/// is in a clip in one labeled "zunda", and the second, from the tone on at twice the speed, in
/// another clip labeled so.
const CONVERSATION: &str = r#"import { Audio, Clip, LipSync, Sequence, Timeline } from "framescript"
export default function Main() {
  return (
    <Timeline>
      <LipSync clip="zunda" open="open.png" closed="closed.png" style={{ width: "100%", height: "100%" }} />
      <Sequence>
        <Clip label="metan">
          <Audio src="voice.wav" trimStart={1} trimEnd={1.5} />
        </Clip>
        <Clip label="zunda">
          <Clip label="line 1">
            <Audio src="voice.wav" />
          </Clip>
        </Clip>
        <Clip label="zunda">
          <Audio src="voice.wav" trimStart={1} playbackRate={2} />
        </Clip>
      </Sequence>
    </Timeline>
  )
}
"#;

/// Without a label, the mouth follows the clip it is in, and not another heard at the same time.
const IN_ITS_CLIP: &str = r#"import { Audio, Clip, LipSync, Timeline } from "framescript"
export default function Main() {
  return (
    <Timeline>
      <Clip label="other">
        <Audio src="voice.wav" trimStart={1} trimEnd={2} />
      </Clip>
      <Clip label="mine">
        <Audio src="voice.wav" />
        <LipSync open="open.png" closed="closed.png" style={{ width: "100%", height: "100%" }} />
      </Clip>
    </Timeline>
  )
}
"#;

/// Whether the mouth is open at `frame`: white in the middle, or black.
fn open(gpu: &mut OffscreenRenderer, c: &mut Composition, frame: u32) -> bool {
    let (scene, _) = c.render(frame).expect("it renders");
    let rgba = gpu.rgba(&scene);
    let middle = (24 * 64 + 32) * 4;
    match rgba[middle] {
        255 => true,
        0 => false,
        other => panic!("frame {frame} is {other}, neither mouth"),
    }
}

#[test]
fn how_loud_a_file_is_is_read_every_hundredth_of_a_second() {
    let Some(dir) = project("levels", CONVERSATION) else { return };
    assert_eq!(LEVELS_PER_SECOND, 100);
    let source = AudioSource::open(&dir.join("voice.wav")).expect("it opens");
    let levels = source.levels().expect("it is read");
    assert!((levels.len() as i64 - 300).abs() <= 1, "{}", levels.len());
    // A sine at 0.5 has a root mean square of 0.5 / √2.
    let tone = 0.5 / 2f32.sqrt();
    for (i, &level) in levels.iter().enumerate().take(299) {
        // Where it starts and stops, reading at a lower rate blurs it.
        if [99, 199].contains(&i) {
            continue;
        }
        let expected = if (100..200).contains(&i) { tone } else { 0.0 };
        assert!((level - expected).abs() < 0.01, "level {i} is {level}");
    }
    // It is kept: the same levels the second time.
    assert!(std::sync::Arc::ptr_eq(&levels, &source.levels().unwrap()));
}

#[test]
fn the_mouth_is_open_while_its_clips_are_heard() {
    let Some(dir) = project("mouth", CONVERSATION) else { return };
    let Ok(mut gpu) = OffscreenRenderer::new() else {
        eprintln!("no GPU to draw with; skipped");
        return;
    };
    let mut composition = Composition::load(&dir).expect("it loads");
    // "metan" for 15 frames, the first line for 90 (the tone at 45..75), the second for 30 (the
    // tone for the first 15).
    assert_eq!(composition.info().duration_frames, 15 + 90 + 30);
    for (frame, expected) in [
        (5, false),
        (30, false),
        (50, true),
        (70, true),
        (80, false),
        (110, true),
        (125, false),
        (60, true),
        (10, false),
    ] {
        assert_eq!(open(&mut gpu, &mut composition, frame), expected, "frame {frame}");
    }
}

#[test]
fn without_a_label_the_mouth_follows_its_own_clip() {
    let Some(dir) = project("own", IN_ITS_CLIP) else { return };
    let Ok(mut gpu) = OffscreenRenderer::new() else {
        eprintln!("no GPU to draw with; skipped");
        return;
    };
    let mut composition = Composition::load(&dir).expect("it loads");
    // "other" is loud for its first 30 frames, "mine" from 30 to 60.
    for (frame, expected) in [(10, false), (20, false), (40, true), (55, true), (70, false)] {
        assert_eq!(open(&mut gpu, &mut composition, frame), expected, "frame {frame}");
    }
}

