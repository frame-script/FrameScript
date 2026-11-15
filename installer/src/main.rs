//! Puts FrameScript on this computer and makes projects for it.
//!
//! FrameScript is built from the source of a release, once for each version, in a directory of its
//! own (see `install`). What it needs from the system is looked at first, and what is missing is
//! put in with the system's package manager, or downloaded, when the person says yes. Every
//! question has an option that answers it, and without a terminal nothing is asked, so that a
//! program (an AI agent, a script) can drive this as well as a person.

mod checks;
mod download;
mod ffmpeg;
mod install;
mod project;
mod system;
mod ui;

use checks::Need;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use ui::{Answers, Ui};

/// Something that is needed is missing, or a question went unanswered.
const MISSING: u8 = 2;

fn usage() -> String {
    format!(
        "\
create-framescript: puts FrameScript on this computer and makes projects for it

usage:
  create-framescript [<project>]  checks what FrameScript needs (and puts in what is missing),
                                  installs it, and makes a project in the directory <project>
  create-framescript new <project> [--width W] [--height H] [--fps F]
                                  the same, with the project's size (1920x1080, 60 fps)
  create-framescript install      installs the latest release (or --version), and puts it on
                                  the PATH
  create-framescript doctor [--json]
                                  says what is there and what is missing, and changes nothing
  create-framescript ffmpeg       downloads FFmpeg 9 for FrameScript, even if the system has one

options:
  -y, --yes          answers yes to every question: installs packages (with sudo), downloads
                     FFmpeg, builds FrameScript and puts it on the PATH
  -n, --no           answers no to every question
  --version TAG      the release of FrameScript to install or to use (default: the latest)
  --home DIR         where FrameScript goes (default: $FRAMESCRIPT_HOME, or {home})
  --no-path          leaves the PATH and the shell's files as they are
  --keep-build       keeps what the build leaves (some GB), for a faster build next time
  --reinstall        builds the release again even if it is installed
  -h, --help         this

Without a terminal, nothing is asked: what would have been is said, and the exit code is 2.
For programs: `doctor --json` says what is missing and how it is put in, and `--yes` does it.
exit codes: 0 done, 1 failed, 2 something needed is missing (do what is said, or add --yes)
",
        home = install::default_home().display()
    )
}

enum Command {
    Help,
    New(Option<String>),
    Install,
    Doctor,
    Ffmpeg,
}

struct Options {
    answers: Answers,
    version: Option<String>,
    home: PathBuf,
    no_path: bool,
    keep_build: bool,
    reinstall: bool,
    json: bool,
    size: project::Size,
}

fn parse(args: &[String]) -> Result<(Command, Options), String> {
    let mut options = Options {
        answers: Answers::Ask,
        version: None,
        home: install::default_home(),
        no_path: false,
        keep_build: false,
        reinstall: false,
        json: false,
        size: project::Size {
            width: 1920,
            height: 1080,
            fps: 60.0,
        },
    };
    let mut words: Vec<&str> = Vec::new();
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        let mut value = |name: &str| {
            args.next()
                .cloned()
                .ok_or_else(|| format!("{name} needs a value"))
        };
        match arg.as_str() {
            "-h" | "--help" => return Ok((Command::Help, options)),
            "-y" | "--yes" => options.answers = Answers::Yes,
            "-n" | "--no" => options.answers = Answers::No,
            "--version" => options.version = Some(value("--version")?),
            "--home" => options.home = PathBuf::from(value("--home")?),
            "--no-path" => options.no_path = true,
            "--keep-build" => options.keep_build = true,
            "--reinstall" => options.reinstall = true,
            "--json" => options.json = true,
            "--width" => options.size.width = number(&value("--width")?)?,
            "--height" => options.size.height = number(&value("--height")?)?,
            "--fps" => {
                let fps: f64 = value("--fps")?
                    .parse()
                    .map_err(|_| "--fps needs a number".to_owned())?;
                if !(fps > 0.0 && fps.is_finite()) {
                    return Err("--fps needs a number above 0".into());
                }
                options.size.fps = fps;
            }
            flag if flag.starts_with('-') && flag.len() > 1 => {
                return Err(format!("there is no option {flag}"));
            }
            word => words.push(word),
        }
    }
    let command = match words.as_slice() {
        [] => Command::New(None),
        ["new"] => Command::New(None),
        ["new", project] => Command::New(Some((*project).to_owned())),
        ["install"] => Command::Install,
        ["doctor"] => Command::Doctor,
        ["ffmpeg"] => Command::Ffmpeg,
        [project] => Command::New(Some((*project).to_owned())),
        _ => return Err(format!("what is `{}`?", words.join(" "))),
    };
    Ok((command, options))
}

fn number(text: &str) -> Result<u32, String> {
    text.parse()
        .ok()
        .filter(|n| *n > 0)
        .ok_or_else(|| format!("{text} isn't a size"))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (command, options) = match parse(&args) {
        Ok(parsed) => parsed,
        Err(e) => {
            eprintln!("error: {e}\n\n{}", usage());
            return ExitCode::FAILURE;
        }
    };
    match run(command, &options) {
        Ok(code) => code,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run(command: Command, options: &Options) -> Result<ExitCode, String> {
    let ui = Ui::new(options.answers);
    let home = &options.home;
    match command {
        Command::Help => {
            print!("{}", usage());
            Ok(ExitCode::SUCCESS)
        }
        Command::Doctor => {
            let report = checks::run(home);
            if options.json {
                let mut json = checks::to_json(&report);
                json["home"] = home.display().to_string().into();
                json["installed"] = install::installed(home).into();
                json["current"] = install::current(home).into();
                json["launcher"] = install::current(home)
                    .map(|_| install::launcher(home).display().to_string())
                    .into();
                json["system"] = system::name().into();
                json["arch"] = std::env::consts::ARCH.into();
                println!("{}", serde_json::to_string_pretty(&json).expect("JSON"));
            } else {
                describe(home, &report);
                checks::print(&report);
            }
            Ok(exit(report.ready(&[Need::Build, Need::Run, Need::Media])))
        }
        Command::Ffmpeg => {
            ffmpeg::download(home)?;
            println!("FFmpeg 9 is in {}.", home.join("ffmpeg").display());
            if install::current(home).is_some() {
                install::write_launcher(home)?;
            }
            Ok(ExitCode::SUCCESS)
        }
        Command::Install => {
            let Some((version, report)) = prepare(options, &ui, true)? else {
                return Ok(ExitCode::from(MISSING));
            };
            println!(
                "\nFrameScript {version} is installed: `framescript <project>` opens a project \
                 ({}).",
                install::launcher(home).display()
            );
            Ok(exit(
                report.ready(&[Need::Build, Need::Run, Need::Media]) && !ui.unanswered(),
            ))
        }
        Command::New(name) => {
            let name = match name.or_else(|| ui.text("The project's name (a directory to make):")) {
                Some(name) => name,
                None => {
                    eprintln!(
                        "error: which project? `create-framescript <project>`\n\n{}",
                        usage()
                    );
                    return Ok(ExitCode::FAILURE);
                }
            };
            let dir = PathBuf::from(&name);
            // Before anything is built for it.
            if std::fs::read_dir(&dir).is_ok_and(|mut e| e.next().is_some()) {
                return Err(format!(
                    "{} is there already, with something in it",
                    dir.display()
                ));
            }
            let Some((version, report)) = prepare(options, &ui, false)? else {
                return Ok(ExitCode::from(MISSING));
            };
            project::create(&dir, &options.size, home, &version)?;
            made(&dir, home, &version, &report);
            Ok(ExitCode::SUCCESS)
        }
    }
}

fn exit(ready: bool) -> ExitCode {
    if ready {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(MISSING)
    }
}

fn describe(home: &Path, report: &checks::Report) {
    let installed = install::installed(home);
    let current = install::current(home);
    println!("FrameScript's home: {}", home.display());
    if installed.is_empty() {
        println!("Installed: nothing yet");
    } else {
        let list: Vec<String> = installed
            .iter()
            .map(|v| {
                if Some(v) == current.as_ref() {
                    format!("{v} (current)")
                } else {
                    v.clone()
                }
            })
            .collect();
        println!("Installed: {}", list.join(", "));
    }
    println!(
        "System: {}, {}, package manager: {}\n",
        system::name(),
        std::env::consts::ARCH,
        report.pm.map_or("none known", system::Pm::name)
    );
}

/// Has what is needed put in, and the version installed. `None` when it can't be: why is said.
fn prepare(
    options: &Options,
    ui: &Ui,
    update: bool,
) -> Result<Option<(String, checks::Report)>, String> {
    let home = &options.home;
    ui::heading("What FrameScript needs");
    let mut report = checks::run(home);
    describe(home, &report);
    checks::print(&report);
    if !report.ready(&[Need::Build, Need::Run, Need::Media, Need::Optional]) {
        ui::heading("Putting in what is missing");
        if checks::fix_missing(&report, ui, home) {
            report = checks::run(home);
            ui::heading("Now");
            checks::print(&report);
        }
    }

    let current = install::current(home);
    let version = match (&options.version, &current) {
        (Some(version), _) => version.clone(),
        (None, Some(current)) if !update && !options.reinstall => current.clone(),
        (None, _) => match install::latest_release() {
            Ok(latest) => latest,
            Err(e) => match &current {
                Some(current) => {
                    ui::warn(&format!(
                        "can't tell which release is the latest ({e}): {current} is kept"
                    ));
                    current.clone()
                }
                None => return Err(format!("can't tell which release is the latest: {e}")),
            },
        },
    };

    if !install::is_installed(home, &version) || options.reinstall {
        ui::heading(&format!("FrameScript {version}"));
        if !report.ready(&[Need::Build]) {
            println!("FrameScript can't be built until what is missing above is there.");
            return Ok(None);
        }
        // `install` is asked for; a project only needs it.
        let asked = update
            || ui.confirm(&format!(
                "Build FrameScript {version} now, into {}? It takes 10–30 minutes.",
                install::source(home, &version).display()
            ));
        if !asked {
            return Ok(None);
        }
        install::install(
            home,
            &version,
            &install::Build {
                keep: options.keep_build,
                again: options.reinstall,
            },
        )?;
    }
    if update || current.is_none() {
        install::set_current(home, &version)?;
    }
    install::write_launcher(home)?;
    if !options.no_path {
        install::put_on_path(home, ui);
    }
    if !report.ready(&[Need::Run]) {
        ui::warn("FrameScript won't run until what is missing above is there");
    }
    if !report.ready(&[Need::Media]) {
        ui::warn("without FFmpeg 9, videos and sounds aren't read and nothing is exported");
    }
    Ok(Some((version, report)))
}

fn made(dir: &Path, home: &Path, version: &str, report: &checks::Report) {
    let shown = dir.display();
    println!("\nMade {shown}, for FrameScript {version}.");
    println!("  framescript {shown}                                  opens it in the studio");
    println!("  framescript render {shown} --frame 0 --out frame.png  draws a frame");
    println!("  framescript export {shown}                           writes the video");
    if !system::on_path(&home.join("bin")) {
        println!(
            "(framescript is {} until a new terminal has it on the PATH)",
            install::launcher(home).display()
        );
    }
    println!("AGENTS.md in it tells an AI agent how to work on it.");
    if !report.ready(&[Need::Media]) {
        ui::warn("FFmpeg 9 is missing: `create-framescript doctor` says how to put it in");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(args: &[&str]) -> Result<(Command, Options), String> {
        parse(&args.iter().map(|a| (*a).to_owned()).collect::<Vec<_>>())
    }

    #[test]
    fn the_command_line_is_understood() {
        let (command, options) = parsed(&["my-video", "--yes", "--fps", "30"]).unwrap();
        assert!(matches!(command, Command::New(Some(ref n)) if n == "my-video"));
        assert_eq!(options.answers, Answers::Yes);
        assert_eq!(options.size.fps, 30.0);
        let (command, options) =
            parsed(&["new", "a", "--width", "1280", "--height", "720"]).unwrap();
        assert!(matches!(command, Command::New(Some(ref n)) if n == "a"));
        assert_eq!((options.size.width, options.size.height), (1280, 720));
        assert!(matches!(
            parsed(&["doctor", "--json"]).unwrap().0,
            Command::Doctor
        ));
        assert!(matches!(parsed(&[]).unwrap().0, Command::New(None)));
        assert!(parsed(&["--width", "0", "a"]).is_err());
        assert!(parsed(&["--nonsense"]).is_err());
        assert!(parsed(&["a", "b"]).is_err());
        assert!(parsed(&["--version"]).is_err());
    }
}
