//! `framescript`: the studio, and rendering from the command line.
//!
//! ```sh
//! framescript examples/hello                       # the studio
//! framescript render examples/hello -f 90 -o a.png # one frame, as a PNG
//! ```

mod preview;
mod studio;
mod timeline;

use framescript_engine::Composition;
use framescript_engine::render::{OffscreenRenderer, write_png};
use std::path::PathBuf;
use std::process::ExitCode;

const USAGE: &str = "\
usage:
  framescript [studio] <project>
  framescript render <project> [--frame N]... [--out FILE] [--width W]

render writes FILE (default frame-N.png; with several frames, {} in FILE is the frame number)";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("render") => render(&args[1..]),
        Some("studio") => studio(&args[1..]),
        Some("-h" | "--help") | None => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Some(_) => studio(&args),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("framescript: {e}");
            ExitCode::FAILURE
        }
    }
}

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

fn studio(args: &[String]) -> Result<()> {
    let [dir] = args else {
        return Err(USAGE.into());
    };
    studio::run(PathBuf::from(dir))
}

fn render(args: &[String]) -> Result<()> {
    let mut dir = None;
    let mut frames = Vec::new();
    let mut out = None;
    let mut width = None;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let mut value = || it.next().ok_or_else(|| format!("{a} needs a value"));
        match a.as_str() {
            "-f" | "--frame" => frames.push(value()?.parse::<u32>()?),
            "-o" | "--out" => out = Some(value()?.clone()),
            "-w" | "--width" => width = Some(value()?.parse::<u32>()?),
            _ if dir.is_none() => dir = Some(PathBuf::from(a)),
            _ => return Err(format!("what is {a}?\n{USAGE}").into()),
        }
    }
    let dir = dir.ok_or(USAGE)?;
    if frames.is_empty() {
        frames.push(0);
    }

    let t = std::time::Instant::now();
    let mut composition = Composition::load(&dir)?;
    eprintln!(
        "loaded {} in {:.1} ms: {} frames, {} clips",
        composition.settings().name,
        t.elapsed().as_secs_f64() * 1000.0,
        composition.info().duration_frames,
        composition.info().clips.len()
    );
    if let Some(w) = width {
        composition.fit(w, u32::MAX);
    }
    let mut renderer = OffscreenRenderer::new()?;
    for &frame in &frames {
        let (scene, timings) = composition.render(frame)?;
        let rgba = renderer.rgba(&scene);
        let path = match &out {
            Some(o) if frames.len() > 1 => o.replace("{}", &frame.to_string()),
            Some(o) => o.clone(),
            None => format!("frame-{frame}.png"),
        };
        write_png(path.as_ref(), scene.width, scene.height, &rgba)?;
        eprintln!(
            "frame {frame} -> {path} ({}x{}; script {:.2} ms, layout {:.2} ms, paint {:.2} ms)",
            scene.width,
            scene.height,
            timings.script.as_secs_f64() * 1000.0,
            timings.layout.as_secs_f64() * 1000.0,
            timings.paint.as_secs_f64() * 1000.0,
        );
    }
    Ok(())
}
