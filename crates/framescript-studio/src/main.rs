//! `framescript`: the studio, and rendering from the command line.
//!
//! ```sh
//! framescript examples/hello                       # the studio
//! framescript render examples/hello -f 90 -o a.png # one frame, as a PNG
//! framescript export examples/hello -o hello.mp4   # the whole video
//! ```

mod export;
mod preview;
mod studio;
mod timeline;

use framescript_engine::export::{Codec, Export, ExportSettings, Speed, Stage};
use framescript_engine::{Composition, ProjectSettings};
use framescript_engine::render::{OffscreenRenderer, write_png};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const USAGE: &str = "\
usage:
  framescript [studio] <project>
  framescript render <project> [--frame N]... [--out FILE] [--width W]
  framescript export <project> [--out FILE] [--codec h264|h265|av1|prores] [--quality CRF]
                     [--speed fast|medium|slow] [--scale S] [--from F] [--to F]
                     [--workers N] [--audio KBPS | --no-audio]

render writes FILE (default frame-N.png; with several frames, {} in FILE is the frame number)
export writes FILE (default <project>/out/<name>.mp4), drawing frames on N threads at once;
the frames are F up to (not with) F of --to";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("render") => render(&args[1..]),
        Some("export") => export(&args[1..]),
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

fn export(args: &[String]) -> Result<()> {
    let mut dir = None;
    let mut out = None;
    let mut codec = Codec::H264;
    let mut quality = None;
    let mut speed = Speed::Medium;
    let mut scale = 1.0;
    let (mut from, mut to) = (None, None);
    let mut workers = None;
    let mut audio = Some(192);
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let mut value = || it.next().ok_or_else(|| format!("{a} needs a value"));
        match a.as_str() {
            "-o" | "--out" => out = Some(PathBuf::from(value()?)),
            "--codec" => {
                let v = value()?;
                codec = Codec::from_name(v).ok_or_else(|| format!("no codec {v}"))?;
            }
            "--quality" => quality = Some(value()?.parse::<u32>()?),
            "--speed" => {
                let v = value()?;
                speed = Speed::from_name(v).ok_or_else(|| format!("no speed {v}"))?;
            }
            "--scale" => scale = value()?.parse::<f64>()?,
            "--from" => from = Some(value()?.parse::<u32>()?),
            "--to" => to = Some(value()?.parse::<u32>()?),
            "--workers" => workers = Some(value()?.parse::<usize>()?),
            "--audio" => audio = Some(value()?.parse::<u32>()?),
            "--no-audio" => audio = None,
            _ if dir.is_none() => dir = Some(PathBuf::from(a)),
            _ => return Err(format!("what is {a}?\n{USAGE}").into()),
        }
    }
    let dir = dir.ok_or(USAGE)?;
    let output = out.unwrap_or_else(|| default_output(&dir, codec));
    let mut settings = ExportSettings::new(output, codec);
    settings.quality = quality.unwrap_or(codec.default_quality());
    settings.speed = speed;
    settings.scale = scale;
    settings.audio = audio;
    if let Some(w) = workers {
        settings.workers = w.max(1);
    }
    if from.is_some() || to.is_some() {
        settings.range = Some((from.unwrap_or(0), to.unwrap_or(u32::MAX)));
    }
    eprintln!("exporting {} with {} workers", dir.display(), settings.workers);
    let (send, receive) = std::sync::mpsc::channel();
    let job = Export::start(dir, settings, move |p| {
        let _ = send.send(p);
    });
    let mut last = None;
    for p in receive {
        eprint!(
            "\r{:<9} {:>6} / {} frames  {:>6.1} fps  {:>6.1} s",
            match p.stage {
                Stage::Starting => "loading",
                Stage::Rendering => "drawing",
                Stage::Joining => "joining",
                _ => "",
            },
            p.done,
            p.total,
            p.rate,
            p.elapsed.as_secs_f64()
        );
        let _ = std::io::stderr().flush();
        last = Some(p);
    }
    eprintln!();
    job.wait();
    let p = last.ok_or("the export said nothing")?;
    match p.stage {
        Stage::Done => {
            eprintln!(
                "wrote {} ({}×{}, {} frames) in {:.1} s",
                p.output.display(),
                p.size.0,
                p.size.1,
                p.total,
                p.elapsed.as_secs_f64()
            );
            Ok(())
        }
        Stage::Failed(e) => Err(e.into()),
        _ => Err("it was cancelled".into()),
    }
}

/// `out/<name>.<ext>` in the project, named as `framescript.json` names it.
pub fn default_output(dir: &Path, codec: Codec) -> PathBuf {
    let name = ProjectSettings::read(dir).map_or_else(|_| "video".into(), |s| s.name);
    dir.join("out").join(format!("{name}.{}", codec.extension()))
}
