//! What the preview plays, by way of an ALSA device that writes it to a file. This is alone in its
//! process since ALSA reads its configuration once.
//!
//! `ramp.wav` says which sample it is, as in `tests/sound.rs`. Without ffmpeg or ALSA, the test is
//! skipped.

use framescript_engine::{AudioPlayer, Composition};
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};

#[test]
fn what_is_played_is_the_mix_and_the_clock_is_what_is_heard() {
    if !std::path::Path::new("/usr/lib/libasound.so.2").exists()
        && !std::path::Path::new("/usr/lib/x86_64-linux-gnu/libasound.so.2").exists()
    {
        eprintln!("skipped: no ALSA");
        return;
    }
    let dir = std::env::temp_dir().join(format!("framescript-playback-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let made = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-f", "lavfi", "-i"])
        .arg("aevalsrc=exprs='mod(n\\,1000)*16/32768|floor(n/1000)*16/32768':s=48000:d=3")
        .args(["-c:a", "pcm_s16le"])
        .arg(dir.join("ramp.wav"))
        .status();
    if !made.is_ok_and(|s| s.success()) {
        eprintln!("skipped: no ffmpeg to make sound with");
        return;
    }
    std::fs::write(
        dir.join("framescript.json"),
        r#"{ "width": 64, "height": 48, "fps": 30, "entry": "main.tsx", "duration": 2 }"#,
    )
    .unwrap();
    std::fs::write(
        dir.join("main.tsx"),
        r#"import { Audio } from "framescript"
export default function Main() {
  return <Audio src="ramp.wav" trimStart={0.5} />
}
"#,
    )
    .unwrap();
    let raw = dir.join("out.raw");
    let config = dir.join("asound.conf");
    std::fs::write(
        &config,
        format!(
            "pcm.nothing {{ type null }}\n\
             pcm.filed {{ type file slave.pcm \"nothing\" file \"{}\" format \"raw\" }}\n",
            raw.display()
        ),
    )
    .unwrap();
    // SAFETY: nothing else in this process reads the environment while this runs.
    unsafe {
        std::env::set_var("ALSA_CONFIG_PATH", &config);
        std::env::set_var("ANTIWEBUI_AUDIO_DEVICE", "filed");
    }

    let c = Composition::load(&dir).expect("it loads");
    let player = AudioPlayer::new();
    player.set_plan(Arc::clone(c.audio()));
    let start = Instant::now();
    player.play(0.25, 2.0);
    let mut seen = Vec::new();
    while start.elapsed() < Duration::from_millis(600) {
        seen.push((start.elapsed().as_secs_f64(), player.position().expect("it plays")));
        std::thread::sleep(Duration::from_millis(20));
    }
    player.stop();
    drop(player);

    // The clock goes with the time, from where it started, never back.
    assert!(seen.windows(2).all(|w| w[1].1 >= w[0].1), "{seen:?}");
    let (elapsed, at) = *seen.last().unwrap();
    assert!(at > 0.25 + elapsed - 0.35 && at <= 0.25 + elapsed + 0.01, "{at} after {elapsed}");

    // What was written is the file from 0.75 s on, every sample of it, in order.
    let bytes = std::fs::read(&raw).expect("something was written");
    let samples: Vec<i16> = bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect();
    assert!(samples.len() / 2 >= 48000 / 4, "{} pairs", samples.len() / 2);
    for (i, pair) in samples.chunks_exact(2).enumerate() {
        let n = pair[1] as i64 / 16 * 1000 + pair[0] as i64 / 16;
        assert_eq!(n, 36_000 + i as i64, "at {i}");
    }
}
