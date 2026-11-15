//! How fast frames with videos come, as the preview asks for them: playing on, scrubbing, and
//! jumping about.
//!
//!   cargo run --release -p framescript-engine --example seek -- examples/media [first] [last]

use framescript_engine::{Composition, Media, Wait};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant};

fn main() {
    let mut args = std::env::args().skip(1);
    let dir = PathBuf::from(args.next().unwrap_or_else(|| "examples/media".into()));
    let media = Media::new();
    let (tx, rx) = mpsc::channel();
    media.set_listener(move || {
        let _ = tx.send(());
    });
    let mut c = Composition::load_with(&dir, media.clone()).expect("it loads");
    let total = c.info().duration_frames;
    let first: u32 = args.next().map_or(0, |a| a.parse().unwrap());
    let last: u32 = args.next().map_or(total - 1, |a| a.parse().unwrap());
    println!("{} frames, {first}..={last}, at {:?}", total, c.size());

    // Playing: a frame each 1/60 s, as long as making it takes less.
    let mut stand_ins = 0;
    let mut worst = Duration::ZERO;
    let t = Instant::now();
    for frame in first..=last {
        let start = Instant::now();
        let r = c.render_with(frame, Wait::PREVIEW).expect("it renders");
        let took = start.elapsed();
        worst = worst.max(took);
        stand_ins += usize::from(!r.complete);
        if let Some(rest) = Duration::from_secs_f64(1.0 / 60.0).checked_sub(took) {
            std::thread::sleep(rest);
        }
    }
    let n = last - first + 1;
    println!(
        "playing {n} frames: {:.1} s for {:.1} s of video, worst frame {:.1} ms, {stand_ins} with a stand-in",
        t.elapsed().as_secs_f64(),
        n as f64 / 60.0,
        worst.as_secs_f64() * 1e3,
    );

    // Jumping about: until each shows what it should.
    let mut state = 0x2545_f491_u64;
    let mut times = Vec::new();
    for _ in 0..40 {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let frame = first + (state % n as u64) as u32;
        let start = Instant::now();
        let mut r = c.render_with(frame, Wait::PREVIEW).expect("it renders");
        let first_picture = start.elapsed();
        while !r.complete {
            rx.recv_timeout(Duration::from_secs(10)).expect("frames come");
            r = c.render_with(frame, Wait::PREVIEW).expect("it renders");
        }
        times.push((first_picture, start.elapsed()));
        while rx.try_recv().is_ok() {}
    }
    let mut exact: Vec<f64> = times.iter().map(|t| t.1.as_secs_f64() * 1e3).collect();
    exact.sort_by(f64::total_cmp);
    let shown = times.iter().map(|t| t.0.as_secs_f64() * 1e3).fold(0.0, f64::max);
    println!(
        "jumping: something shows within {shown:.1} ms; the right frame in {:.1} ms (median), {:.1} ms (worst)",
        exact[exact.len() / 2],
        exact[exact.len() - 1],
    );

    // Scrubbing back over what was played: there already, as far as the cache holds it.
    let start = Instant::now();
    let mut stand_ins = 0;
    for frame in (first..=last).rev().step_by(3) {
        stand_ins += usize::from(!c.render_with(frame, Wait::PREVIEW).expect("it renders").complete);
    }
    println!(
        "scrubbing back: {:.2} ms a frame, {stand_ins} with a stand-in",
        start.elapsed().as_secs_f64() * 1e3 / n.div_ceil(3) as f64
    );
}
