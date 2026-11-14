//! Sound in a composition: where each piece is, and what comes out when it is mixed.
//!
//! `ramp.wav` is made with the ffmpeg command line: 3 s at 48 kHz in two channels, which says
//! which sample it is (sample `n` is `(n % 1000) * 16 / 32768` on the left and
//! `(n / 1000) * 16 / 32768` on the right). Without ffmpeg, the tests are skipped.

use framescript_engine::sound::RATE;
use framescript_engine::{AudioPlayer, Composition};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};

const UNIT: f32 = 16.0 / 32768.0;

fn ffmpeg(args: &[&str]) -> bool {
    Command::new("ffmpeg")
        .args(["-v", "error", "-y"])
        .args(args)
        .status()
        .is_ok_and(|s| s.success())
}

fn project(name: &str) -> Option<PathBuf> {
    let dir = std::env::temp_dir().join(format!("framescript-sound-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let ramp = dir.join("ramp.wav");
    let beeps = dir.join("beeps.mp4");
    let made = ffmpeg(&[
        "-f",
        "lavfi",
        "-i",
        "aevalsrc=exprs='mod(n\\,1000)*16/32768|floor(n/1000)*16/32768':s=48000:d=3",
        "-c:a",
        "pcm_s16le",
        ramp.to_str().unwrap(),
    ]) && ffmpeg(&[
        "-f",
        "lavfi",
        "-i",
        "color=black:s=64x48:r=30:d=1",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=1",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        beeps.to_str().unwrap(),
    ]);
    if !made {
        eprintln!("no ffmpeg to make sound with; skipped");
        return None;
    }
    std::fs::write(
        dir.join("framescript.json"),
        r#"{ "width": 64, "height": 48, "fps": 30, "entry": "main.tsx" }"#,
    )
    .unwrap();
    std::fs::write(
        dir.join("main.tsx"),
        r#"import { Audio, Clip, Sequence, Video } from "framescript"
export default function Main() {
  return (
    <Sequence>
      <Clip label="cut short" duration={30}>
        <Audio src="ramp.wav" trimStart={0.5} />
      </Clip>
      <Clip label="quieter, then not">
        <Audio src="ramp.wav" trimStart={1} trimEnd={2} volume={(f) => (f < 15 ? 0.5 : 1)} />
      </Clip>
      <Clip label="twice as fast">
        <Audio src="ramp.wav" playbackRate={2} fadeIn={0.25} />
      </Clip>
      <Clip label="video" duration={15}>
        <Video src="beeps.mp4" />
        <Video src="beeps.mp4" muted />
      </Clip>
    </Sequence>
  )
}
"#,
    )
    .unwrap();
    Some(dir)
}

/// Which sample of `ramp.wav` the pair at `i` is, at `gain`.
fn number(samples: &[f32], i: usize, gain: f32) -> i64 {
    let low = (samples[i * 2] / gain / UNIT).round() as i64;
    let high = (samples[i * 2 + 1] / gain / UNIT).round() as i64;
    high * 1000 + low
}

fn mixed(c: &Composition, from: f64, to: f64) -> Vec<f32> {
    let pairs = ((to - from) * RATE as f64).round() as usize;
    let mut out = vec![0.0; pairs * 2];
    let at = (from * RATE as f64).round() as i64;
    assert!(c.audio().mix(at, &mut out, Duration::from_secs(10)), "everything is there");
    out
}

#[test]
fn sound_is_where_the_clips_say_and_sounds_as_they_say() {
    let Some(dir) = project("plan") else { return };
    let c = Composition::load(&dir).expect("it loads");
    assert_eq!(c.info().duration_frames, 30 + 30 + 45 + 15);

    let clips: Vec<_> = c.audio().clips().collect();
    let spans: Vec<_> = clips.iter().map(|c| (c.src.as_str(), c.start, c.end, c.from, c.rate)).collect();
    assert_eq!(
        spans,
        [
            ("ramp.wav", 0.0, 1.0, 0.5, 1.0),
            ("ramp.wav", 1.0, 2.0, 1.0, 1.0),
            ("ramp.wav", 2.0, 3.5, 0.0, 2.0),
            // The muted one isn't there.
            ("beeps.mp4", 3.5, 3.5 + 1.0 / 30.0 * 15.0, 0.0, 1.0),
        ]
    );
    assert_eq!(clips[1].envelope.as_ref().map(Vec::len), Some(31));

    // Cut short by its clip, from half a second in.
    let out = mixed(&c, 0.0, 1.0);
    for i in 0..out.len() / 2 {
        assert_eq!(number(&out, i, 1.0), 24_000 + i as i64, "at {i}");
    }

    // Half as loud for half a second.
    let out = mixed(&c, 1.0, 2.0);
    for i in (0..out.len() / 2).step_by(97) {
        let seconds = i as f64 / RATE as f64;
        let gain = if seconds < 14.0 / 30.0 {
            0.5
        } else if seconds >= 0.5 {
            1.0
        } else {
            continue;
        };
        assert_eq!(number(&out, i, gain), 48_000 + i as i64, "at {seconds} s");
    }

    // Twice as fast, coming up for a quarter of a second.
    let out = mixed(&c, 2.0, 3.5);
    for i in (RATE as usize / 4..out.len() / 2).step_by(89) {
        assert_eq!(number(&out, i, 1.0), 2 * i as i64, "at {i}");
    }
    let i = RATE as usize / 8;
    assert_eq!(number(&out, i, 0.5), 2 * i as i64);

    // Nothing between the end of one and the start of the next, nor after the end.
    let out = mixed(&c, 3.5 + 0.5, 4.5);
    assert!(out.iter().all(|&s| s == 0.0));
}

#[test]
fn the_sound_of_a_video_is_heard_with_it() {
    let Some(dir) = project("video") else { return };
    let c = Composition::load(&dir).expect("it loads");
    let out = mixed(&c, 3.5, 4.0);
    let loudest = out.iter().fold(0.0f32, |m, s| m.max(s.abs()));
    assert!(loudest > 0.05, "{loudest}");
}

#[test]
fn without_a_device_it_plays_by_the_clock() {
    let Some(dir) = project("clock") else { return };
    // SAFETY: nothing else in this process reads the environment while this runs.
    unsafe { std::env::set_var("ANTIWEBUI_AUDIO_DEVICE", "none") };
    let c = Composition::load(&dir).expect("it loads");
    let player = AudioPlayer::new();
    player.set_plan(Arc::clone(c.audio()));
    assert_eq!(player.position(), None);
    let t = Instant::now();
    player.play(1.0, 4.0);
    std::thread::sleep(Duration::from_millis(100));
    let at = player.position().expect("it plays");
    let elapsed = t.elapsed().as_secs_f64();
    assert!(at > 1.05 && at <= 1.0 + elapsed + 0.01, "{at}");
    player.stop();
    assert_eq!(player.position(), None);
}
