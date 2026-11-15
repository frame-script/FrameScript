//! What FrameScript needs, whether it is there, and how to put in what isn't.

use crate::ffmpeg;
use crate::system::{self, Os, Pm, Vendor};
use crate::ui::{self, Ui};
use serde_json::json;
use std::path::Path;

/// The oldest Rust that builds FrameScript: the newest that its dependencies ask for.
const RUST: (u32, u32) = (1, 90);

/// What a thing is needed for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Need {
    /// Building FrameScript.
    Build,
    /// Running it at all.
    Run,
    /// Videos, sounds and exporting.
    Media,
    /// Something that works without it, but less well.
    Optional,
}

impl Need {
    fn title(self) -> &'static str {
        match self {
            Need::Build => "To build FrameScript",
            Need::Run => "To run it",
            Need::Media => "For videos, sounds and exporting",
            Need::Optional => "Optional",
        }
    }

    fn id(self) -> &'static str {
        match self {
            Need::Build => "build",
            Need::Run => "run",
            Need::Media => "media",
            Need::Optional => "optional",
        }
    }
}

/// How to put a thing in.
#[derive(Clone, Debug, PartialEq)]
pub enum Fix {
    /// Packages of the system's package manager.
    Packages(Vec<String>),
    /// A command to run, and what it does.
    Run(Vec<String>, &'static str),
    /// FFmpeg 9 from FFmpeg-Builds, into the home.
    DownloadFfmpeg,
    /// What the person has to do.
    Manual(String),
}

pub struct Check {
    /// What `--json` calls it.
    pub id: &'static str,
    pub what: &'static str,
    pub need: Need,
    /// What was found, or why nothing was.
    pub found: Result<String, String>,
    pub fix: Option<Fix>,
}

pub struct Report {
    pub pm: Option<Pm>,
    pub checks: Vec<Check>,
}

impl Report {
    /// Whether nothing needed for `needs` is missing.
    pub fn ready(&self, needs: &[Need]) -> bool {
        self.checks
            .iter()
            .all(|c| c.found.is_ok() || !needs.contains(&c.need))
    }

    fn missing(&self) -> impl Iterator<Item = &Check> {
        self.checks.iter().filter(|c| c.found.is_err())
    }
}

/// The parts of the system that a package manager puts in.
#[derive(Clone, Copy)]
enum Part {
    CCompiler,
    PkgConfig,
    Fontconfig,
    Xkbcommon,
    XkbcommonX11,
    Xcb,
    Wayland,
    Vulkan,
    Alsa,
    Ffmpeg,
    Driver(Vendor),
}

/// The packages of a part, for a package manager. `None` when it has none, or this doesn't know.
fn packages(pm: Pm, part: Part) -> Option<&'static [&'static str]> {
    use Pm::*;
    use Vendor::*;
    Some(match (part, pm) {
        (Part::CCompiler, Pacman | Xbps) => &["base-devel"],
        (Part::CCompiler, Apt) => &["build-essential"],
        (Part::CCompiler, Dnf | Zypper) => &["gcc", "gcc-c++", "make"],
        (Part::PkgConfig, Pacman) => &["pkgconf"],
        (Part::PkgConfig, Dnf) => &["pkgconf-pkg-config"],
        (Part::PkgConfig, Apt | Zypper | Xbps) => &["pkg-config"],
        (Part::Fontconfig, Pacman) => &["fontconfig"],
        (Part::Fontconfig, Apt) => &["libfontconfig-dev"],
        (Part::Fontconfig, Dnf | Zypper | Xbps) => &["fontconfig-devel"],
        (Part::Xkbcommon, Pacman) => &["libxkbcommon"],
        (Part::Xkbcommon, Apt) => &["libxkbcommon-dev"],
        (Part::Xkbcommon, Dnf | Zypper | Xbps) => &["libxkbcommon-devel"],
        (Part::XkbcommonX11, Pacman) => &["libxkbcommon-x11"],
        (Part::XkbcommonX11, Apt) => &["libxkbcommon-x11-dev"],
        (Part::XkbcommonX11, Dnf | Zypper) => &["libxkbcommon-x11-devel"],
        (Part::XkbcommonX11, Xbps) => &["libxkbcommon-devel"],
        (Part::Xcb, Pacman) => &["libxcb"],
        (Part::Xcb, Apt) => &["libxcb1-dev"],
        (Part::Xcb, Dnf | Zypper | Xbps) => &["libxcb-devel"],
        (Part::Wayland, Pacman | Xbps) => &["wayland"],
        (Part::Wayland, Apt | Zypper) => &["libwayland-client0"],
        (Part::Wayland, Dnf) => &["libwayland-client"],
        (Part::Vulkan, Pacman) => &["vulkan-icd-loader"],
        (Part::Vulkan, Apt | Zypper) => &["libvulkan1"],
        (Part::Vulkan, Dnf | Xbps) => &["vulkan-loader"],
        (Part::Alsa, Pacman | Dnf | Xbps) => &["alsa-lib"],
        (Part::Alsa, Apt | Zypper) => &["libasound2"],
        // The others have no FFmpeg 9 yet.
        (Part::Ffmpeg, Pacman | Brew) => &["ffmpeg"],
        (Part::Driver(Amd), Pacman) => &["vulkan-radeon"],
        (Part::Driver(Intel), Pacman) => &["vulkan-intel"],
        (Part::Driver(Amd | Intel), Apt | Dnf) => &["mesa-vulkan-drivers"],
        (Part::Driver(Amd), Zypper) => &["libvulkan_radeon"],
        (Part::Driver(Intel), Zypper) => &["libvulkan_intel"],
        (Part::Driver(Amd), Xbps) => &["mesa-vulkan-radeon"],
        (Part::Driver(Intel), Xbps) => &["mesa-vulkan-intel"],
        _ => return None,
    })
}

/// How to put in a part: its packages, or, without a package manager that has it, `manual`.
fn fix(pm: Option<Pm>, parts: &[Part], manual: &str) -> Fix {
    let found: Option<Vec<String>> = pm.and_then(|pm| {
        parts
            .iter()
            .map(|p| packages(pm, *p))
            .collect::<Option<Vec<_>>>()
            .map(|lists| lists.concat().into_iter().map(str::to_owned).collect())
    });
    found.map_or_else(|| Fix::Manual(manual.to_owned()), Fix::Packages)
}

/// Looks at everything. Changes nothing.
pub fn run(home: &Path) -> Report {
    let pm = Pm::detect();
    let mut checks = vec![rust()];
    match system::os() {
        Os::Linux => linux(pm, &mut checks),
        Os::Mac => checks.push(Check {
            id: "xcode",
            what: "Xcode's command line tools",
            need: Need::Build,
            found: system::output("xcode-select", &["-p"])
                .map(|dir| dir.trim().to_owned())
                .ok_or_else(|| "not installed".into()),
            fix: Some(Fix::Run(
                vec!["xcode-select".into(), "--install".into()],
                "opens a window that installs them; run this again once they are in",
            )),
        }),
        _ => {}
    }
    checks.push(ffmpeg_check(home, pm));
    Report { pm, checks }
}

fn rust() -> Check {
    let info = system::output("rustc", &["-vV"]).unwrap_or_default();
    let field = |name: &str| {
        info.lines()
            .find_map(|l| l.strip_prefix(name))
            .map(|v| v.trim().to_owned())
    };
    let update = if system::find_program("rustup").is_some() {
        Fix::Run(
            vec!["rustup".into(), "update".into(), "stable".into()],
            "updates Rust",
        )
    } else {
        Fix::Manual("Install Rust with rustup: https://rustup.rs".into())
    };
    let mut check = Check {
        id: "rust",
        what: "Rust 1.90 or newer, and cargo",
        need: Need::Build,
        found: Err("not installed".into()),
        fix: Some(update),
    };
    let (Some(release), Some(host)) = (field("release:"), field("host:")) else {
        return check;
    };
    if system::find_program("cargo").is_none() {
        check.found = Err(format!(
            "rustc {release} is there, but cargo isn't on the PATH"
        ));
        return check;
    }
    let version: Vec<u32> = release
        .split(['.', '-'])
        .take(2)
        .filter_map(|n| n.parse().ok())
        .collect();
    check.found = if host.contains("musl") {
        check.fix = Some(Fix::Manual(
            "V8 has no build for musl: FrameScript needs a system with glibc".into(),
        ));
        Err(format!("Rust is for {host}"))
    } else if cfg!(windows) && !host.ends_with("-msvc") {
        check.fix = Some(Fix::Manual(
            "FrameScript builds with Rust's MSVC toolchain: install Visual Studio's Build Tools \
             (\"Desktop development with C++\"), then `rustup default stable-msvc`"
                .into(),
        ));
        Err(format!("Rust is for {host}"))
    } else if version.as_slice() < [RUST.0, RUST.1].as_slice() {
        Err(format!("Rust is {release}"))
    } else {
        Ok(format!("{release} ({host})"))
    };
    check
}

fn linux(pm: Option<Pm>, checks: &mut Vec<Check>) {
    let pkg_config = ["pkg-config", "pkgconf"]
        .into_iter()
        .find(|p| system::find_program(p).is_some());
    checks.push(Check {
        id: "c-compiler",
        what: "a C compiler and linker (cc)",
        need: Need::Build,
        found: system::find_program("cc")
            .map(|p| p.display().to_string())
            .ok_or_else(|| "there is no cc".into()),
        fix: Some(fix(
            pm,
            &[Part::CCompiler],
            "a C compiler: gcc or clang, as cc",
        )),
    });
    checks.push(Check {
        id: "pkg-config",
        what: "pkg-config",
        need: Need::Build,
        found: pkg_config
            .map(str::to_owned)
            .ok_or_else(|| "not installed".into()),
        fix: Some(fix(pm, &[Part::PkgConfig], "pkg-config")),
    });
    // What is linked to: its development files, which have a `.pc` for pkg-config.
    for (id, what, module, part) in [
        (
            "fontconfig",
            "fontconfig's development files",
            "fontconfig",
            Part::Fontconfig,
        ),
        (
            "xkbcommon",
            "xkbcommon's development files",
            "xkbcommon",
            Part::Xkbcommon,
        ),
        (
            "xkbcommon-x11",
            "xkbcommon-x11's development files",
            "xkbcommon-x11",
            Part::XkbcommonX11,
        ),
        ("xcb", "xcb's development files", "xcb", Part::Xcb),
    ] {
        let found = match pkg_config {
            Some(p) if system::succeeds(p, &["--exists", module]) => Ok(format!("{module}.pc")),
            Some(_) => Err(format!("pkg-config doesn't know {module}")),
            None => Err("can't tell without pkg-config".into()),
        };
        let manual = format!("the development files of {module}");
        checks.push(Check {
            id,
            what,
            need: Need::Build,
            found,
            fix: Some(fix(pm, &[part], &manual)),
        });
    }
    let library = |name: &str| {
        if system::has_library(name) {
            Ok(name.to_owned())
        } else {
            Err(format!("{name} isn't found"))
        }
    };
    checks.push(Check {
        id: "vulkan",
        what: "Vulkan",
        need: Need::Run,
        found: library("libvulkan.so.1"),
        fix: Some(fix(pm, &[Part::Vulkan], "Vulkan's loader (libvulkan.so.1)")),
    });
    checks.push(driver_check(pm));
    checks.push(Check {
        id: "alsa",
        what: "ALSA, for sound in the studio",
        need: Need::Optional,
        found: library("libasound.so.2"),
        fix: Some(fix(pm, &[Part::Alsa], "ALSA's library (libasound.so.2)")),
    });
    checks.push(Check {
        id: "wayland",
        what: "Wayland's client library, for Wayland sessions",
        need: if std::env::var_os("WAYLAND_DISPLAY").is_some() {
            Need::Run
        } else {
            Need::Optional
        },
        found: library("libwayland-client.so.0"),
        fix: Some(fix(pm, &[Part::Wayland], "Wayland's client library")),
    });
}

/// A Vulkan driver for the GPU, which the GPU decides: Mesa's for AMD and Intel, which are
/// installed, NVIDIA's own, which is the person's to choose.
fn driver_check(pm: Option<Pm>) -> Check {
    let vendors = system::gpu_vendors();
    let mesa: Vec<Part> = vendors
        .iter()
        .filter(|v| **v != Vendor::Nvidia)
        .map(|v| Part::Driver(*v))
        .collect();
    let fix = if vendors.contains(&Vendor::Nvidia) && mesa.is_empty() {
        Fix::Manual("NVIDIA's driver with its Vulkan part (on Arch, nvidia-utils), which this leaves to you".into())
    } else if mesa.is_empty() {
        Fix::Manual("a Vulkan driver for the GPU (Mesa's, for AMD and Intel)".into())
    } else {
        self::fix(pm, &mesa, "Mesa's Vulkan driver for the GPU")
    };
    Check {
        id: "vulkan-driver",
        what: "a Vulkan driver for the GPU",
        need: Need::Run,
        found: if system::has_vulkan_driver() {
            Ok("found in vulkan/icd.d".into())
        } else {
            Err("no driver says it is there (vulkan/icd.d)".into())
        },
        fix: Some(fix),
    }
}

fn ffmpeg_check(home: &Path, pm: Option<Pm>) -> Check {
    let found = ffmpeg::system().or_else(|why| match ffmpeg::bundled(home) {
        Some(dir) => Ok(format!("downloaded, {}", dir.display())),
        None => Err(why),
    });
    let fix = match (pm, system::os()) {
        (Some(pm @ (Pm::Pacman | Pm::Brew)), _) => fix(Some(pm), &[Part::Ffmpeg], ""),
        (None, Os::Mac) => {
            Fix::Manual("FFmpeg 9 from Homebrew (https://brew.sh): `brew install ffmpeg`".into())
        }
        _ if ffmpeg::platform().is_some() => Fix::DownloadFfmpeg,
        _ => Fix::Manual("FFmpeg 9 with its shared libraries".into()),
    };
    Check {
        id: "ffmpeg",
        what: "FFmpeg 9, with its libraries",
        need: Need::Media,
        found,
        fix: Some(fix),
    }
}

/// Says what was found.
pub fn print(report: &Report) {
    for need in [Need::Build, Need::Run, Need::Media, Need::Optional] {
        let checks: Vec<&Check> = report.checks.iter().filter(|c| c.need == need).collect();
        if checks.is_empty() {
            continue;
        }
        println!("{}", need.title());
        for check in checks {
            match &check.found {
                Ok(found) => println!("  [ok]      {}: {found}", check.what),
                Err(why) => println!("  [missing] {}: {why}", check.what),
            }
        }
    }
}

/// What was found, for programs.
pub fn to_json(report: &Report) -> serde_json::Value {
    let checks: Vec<_> = report
        .checks
        .iter()
        .map(|c| {
            let fix = c.found.is_err().then(|| match &c.fix {
                Some(Fix::Packages(packages)) => json!({
                    "kind": "packages",
                    "packages": packages,
                    "manager": report.pm.map(Pm::name),
                }),
                Some(Fix::Run(command, does)) => json!({
                    "kind": "command",
                    "command": system::shown(command),
                    "does": does,
                }),
                Some(Fix::DownloadFfmpeg) => json!({ "kind": "download", "from": ffmpeg::BUILDS }),
                Some(Fix::Manual(text)) => json!({ "kind": "manual", "text": text }),
                None => serde_json::Value::Null,
            });
            json!({
                "id": c.id,
                "what": c.what,
                "need": c.need.id(),
                "ok": c.found.is_ok(),
                "found": c.found.as_ref().ok(),
                "missing": c.found.as_ref().err(),
                "fix": fix,
            })
        })
        .collect();
    json!({
        "packageManager": report.pm.map(Pm::name),
        "checks": checks,
        "readyToBuild": report.ready(&[Need::Build]),
        "readyToRun": report.ready(&[Need::Build, Need::Run]),
        "ready": report.ready(&[Need::Build, Need::Run, Need::Media]),
    })
}

/// Puts in what is missing, asking first: the packages together, then each of the rest. Returns
/// whether anything was tried.
pub fn fix_missing(report: &Report, ui: &Ui, home: &Path) -> bool {
    let mut tried = false;
    let mut packages: Vec<String> = Vec::new();
    for check in report.missing() {
        if let Some(Fix::Packages(list)) = &check.fix {
            for p in list {
                if !packages.contains(p) {
                    packages.push(p.clone());
                }
            }
        }
    }
    if let (Some(pm), false) = (report.pm, packages.is_empty()) {
        let commands = pm.commands(&packages, ui);
        let shown: Vec<String> = commands.iter().map(|c| system::shown(c)).collect();
        let question = format!(
            "Install {} with {}?\n  {}",
            packages.join(", "),
            pm.name(),
            shown.join("\n  ")
        );
        let yes = ui.confirm(&question);
        tried |= yes;
        if yes && !commands.iter().all(|c| system::run(c)) {
            ui::warn("that didn't work: what it said is above");
            if pm == Pm::Pacman {
                println!("  (if pacman couldn't find a package, `sudo pacman -Syu` and try again)");
            }
            if !ui.interactive() {
                println!("  (without a terminal sudo can't ask for a password: run that yourself)");
            }
        }
    }
    for check in report.missing() {
        match &check.fix {
            Some(Fix::Run(command, does)) => {
                let question = format!("Run `{}`? It {does}.", system::shown(command));
                let yes = ui.confirm(&question);
                tried |= yes;
                if yes && !system::run(command) {
                    ui::warn("that didn't work: what it said is above");
                }
            }
            Some(Fix::DownloadFfmpeg) => {
                let question = format!(
                    "Download FFmpeg 9 (about 70–90 MB) from {} into {}?\n  It isn't part of \
                     FrameScript: it is a build of FFmpeg under the GPL, whose license is in it.",
                    ffmpeg::BUILDS,
                    home.join("ffmpeg").display()
                );
                let yes = ui.confirm(&question);
                tried |= yes;
                if yes && let Err(e) = ffmpeg::download(home) {
                    ui::warn(&format!("FFmpeg wasn't downloaded: {e}"));
                }
            }
            Some(Fix::Manual(text)) => println!("To do yourself, for {}: {text}", check.what),
            Some(Fix::Packages(_)) | None => {}
        }
    }
    tried
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_manager_has_what_is_built_with() {
        for pm in [Pm::Pacman, Pm::Apt, Pm::Dnf, Pm::Zypper, Pm::Xbps] {
            for part in [
                Part::CCompiler,
                Part::PkgConfig,
                Part::Fontconfig,
                Part::Xkbcommon,
                Part::XkbcommonX11,
                Part::Xcb,
                Part::Vulkan,
                Part::Alsa,
                Part::Wayland,
                Part::Driver(Vendor::Amd),
                Part::Driver(Vendor::Intel),
            ] {
                assert!(packages(pm, part).is_some(), "{pm:?}");
            }
        }
    }

    #[test]
    fn arch_puts_in_ffmpeg_and_the_others_download_it() {
        assert_eq!(
            fix(Some(Pm::Pacman), &[Part::Ffmpeg], ""),
            Fix::Packages(vec!["ffmpeg".into()])
        );
        assert!(packages(Pm::Apt, Part::Ffmpeg).is_none());
        assert_eq!(
            fix(None, &[Part::Fontconfig], "by hand"),
            Fix::Manual("by hand".into())
        );
    }
}
