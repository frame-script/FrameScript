//! FrameScript itself: the source of a release, built where it stays.
//!
//! ```text
//! <home>/
//!   versions/<tag>/          the source of the release, which the binary reads its library from
//!     bin/framescript        the binary, built there
//!   ffmpeg/                  FFmpeg 9, when it was downloaded (see `ffmpeg`)
//!   bin/framescript          what runs the current version, with that FFmpeg first on the paths
//!   current                  the tag of the current version
//! ```
//!
//! The binary finds FrameScript's library (`packages/framescript`) where its source was when it was
//! built, so the source stays, and is built where it is.

use crate::download;
use crate::ffmpeg;
use crate::system::{self, Os};
use crate::ui::{self, Ui};
use std::path::{Path, PathBuf};
use std::process::Command;

pub const REPOSITORY: &str = "frame-script/FrameScript";

const EXE: &str = std::env::consts::EXE_SUFFIX;

/// Where FrameScript is installed unless it is said: `FRAMESCRIPT_HOME`, or the place of the
/// system for such things.
pub fn default_home() -> PathBuf {
    if let Some(home) = std::env::var_os("FRAMESCRIPT_HOME").filter(|h| !h.is_empty()) {
        return PathBuf::from(home);
    }
    let user = system::home_dir().unwrap_or_else(|| PathBuf::from("."));
    match system::os() {
        Os::Windows => std::env::var_os("LOCALAPPDATA")
            .map_or_else(|| user.join("AppData/Local"), PathBuf::from)
            .join("FrameScript"),
        Os::Mac => user.join("Library/Application Support/FrameScript"),
        _ => std::env::var_os("XDG_DATA_HOME")
            .filter(|d| !d.is_empty())
            .map_or_else(|| user.join(".local/share"), PathBuf::from)
            .join("framescript"),
    }
}

/// The tag of the newest release.
pub fn latest_release() -> Result<String, String> {
    let release = download::json(&format!(
        "https://api.github.com/repos/{REPOSITORY}/releases/latest"
    ))?;
    release["tag_name"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| "the latest release of FrameScript has no tag".into())
}

pub fn source(home: &Path, version: &str) -> PathBuf {
    home.join("versions").join(version)
}

pub fn binary(home: &Path, version: &str) -> PathBuf {
    source(home, version)
        .join("bin")
        .join(format!("framescript{EXE}"))
}

pub fn is_installed(home: &Path, version: &str) -> bool {
    binary(home, version).exists()
}

/// The versions that are built, oldest first by name.
pub fn installed(home: &Path) -> Vec<String> {
    let mut versions: Vec<String> = std::fs::read_dir(home.join("versions"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|v| is_installed(home, v))
        .collect();
    versions.sort();
    versions
}

/// The version the launcher runs.
pub fn current(home: &Path) -> Option<String> {
    let version = std::fs::read_to_string(home.join("current")).ok()?;
    let version = version.trim().to_owned();
    is_installed(home, &version).then_some(version)
}

/// What runs FrameScript.
pub fn launcher(home: &Path) -> PathBuf {
    let name = if cfg!(windows) {
        "framescript.cmd"
    } else {
        "framescript"
    };
    home.join("bin").join(name)
}

pub struct Build {
    pub keep: bool,
    pub again: bool,
}

/// Downloads the source of `version` and builds it. Returns whether it was built now.
pub fn install(home: &Path, version: &str, build: &Build) -> Result<bool, String> {
    if is_installed(home, version) && !build.again {
        println!(
            "FrameScript {version} is installed already ({}).",
            binary(home, version).display()
        );
        return Ok(false);
    }
    let src = source(home, version);
    // A build that was stopped goes on from where it was.
    if !src.join("Cargo.toml").exists() {
        let url = format!("https://codeload.github.com/{REPOSITORY}/tar.gz/refs/tags/{version}");
        println!("Downloading FrameScript {version}");
        let archive = home
            .join("downloads")
            .join(format!("FrameScript-{version}.tar.gz"));
        download::file(&url, &archive).map_err(|e| {
            format!("{e}\n  (is {version} a release? https://github.com/{REPOSITORY}/releases)")
        })?;
        let unpacked = download::unpack(&archive, &src);
        let _ = std::fs::remove_file(&archive);
        // Only when nothing else is in it.
        let _ = std::fs::remove_dir(home.join("downloads"));
        unpacked?;
    }
    println!(
        "Building FrameScript {version} in {}.\n  It takes a while (10–30 minutes the first time), \
         and some GB while it builds.",
        src.display()
    );
    let target = src.join("target");
    let status = Command::new("cargo")
        .args(["build", "--release", "--locked", "-p", "framescript-studio"])
        .current_dir(&src)
        .env("CARGO_TARGET_DIR", &target)
        .status()
        .map_err(|e| format!("can't run cargo: {e}"))?;
    if !status.success() {
        return Err(format!(
            "FrameScript {version} didn't build: why is above. `create-framescript doctor` says \
             what may be missing; the build goes on from where it stopped when this is run again."
        ));
    }
    let built = target.join("release").join(format!("framescript{EXE}"));
    let to = binary(home, version);
    std::fs::create_dir_all(to.parent().expect("in bin"))
        .and_then(|_| std::fs::copy(&built, &to))
        .map_err(|e| format!("{}: {e}", to.display()))?;
    if !build.keep {
        let _ = std::fs::remove_dir_all(&target);
    }
    Ok(true)
}

/// Makes `version` the one the launcher runs.
pub fn set_current(home: &Path, version: &str) -> Result<(), String> {
    std::fs::write(home.join("current"), version).map_err(|e| format!("{}: {e}", home.display()))
}

/// Writes the launcher for the current version, with the downloaded FFmpeg first on the paths
/// when there is one.
pub fn write_launcher(home: &Path) -> Result<PathBuf, String> {
    let version = current(home).ok_or("no FrameScript is installed")?;
    let binary = binary(home, &version);
    let bundled = ffmpeg::bundled(home);
    let path = launcher(home);
    std::fs::create_dir_all(path.parent().expect("in bin"))
        .map_err(|e| format!("{}: {e}", home.display()))?;
    let text = if cfg!(windows) {
        let mut text = format!(
            "@echo off\r\nrem Made by create-framescript: runs FrameScript {version}.\r\nsetlocal\r\n"
        );
        if let Some(dir) = &bundled {
            // Its DLLs are found on the PATH, as its command is.
            text += &format!("set \"PATH={};%PATH%\"\r\n", dir.join("bin").display());
        }
        text += &format!("\"{}\" %*\r\nexit /b %ERRORLEVEL%\r\n", binary.display());
        text
    } else {
        let mut text =
            format!("#!/bin/sh\n# Made by create-framescript: runs FrameScript {version}.\n");
        if let Some(dir) = &bundled {
            let dir = sh_quote(&dir.display().to_string());
            text += &format!("export PATH={dir}/bin:\"$PATH\"\n");
            // The libraries that videos are read with, which are loaded by their names.
            text += &format!(
                "export LD_LIBRARY_PATH={dir}/lib\"${{LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}}\"\n"
            );
        }
        text += &format!("exec {} \"$@\"\n", sh_quote(&binary.display().to_string()));
        text
    };
    std::fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("{}: {e}", path.display()))?;
    }
    Ok(path)
}

fn sh_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "'\\''"))
}

/// Has `framescript` run from any terminal, asking before anything outside the home is touched.
pub fn put_on_path(home: &Path, ui: &Ui) {
    let bin = home.join("bin");
    if system::on_path(&bin) {
        return;
    }
    match system::os() {
        Os::Windows => {
            let question = format!(
                "Add {} to your PATH (yours, not everyone's), so that `framescript` runs in any terminal?",
                bin.display()
            );
            if !ui.confirm(&question) {
                return;
            }
            // Through .NET, which, unlike `setx`, doesn't cut a long PATH short.
            let script = "$d = $env:FRAMESCRIPT_BIN; \
                $p = [Environment]::GetEnvironmentVariable('Path', 'User'); \
                if (-not (($p -split ';') -contains $d)) { \
                  [Environment]::SetEnvironmentVariable('Path', $(if ($p) { \"$p;$d\" } else { $d }), 'User') }";
            let done = Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", script])
                .env("FRAMESCRIPT_BIN", &bin)
                .status()
                .is_ok_and(|s| s.success());
            if done {
                println!("Added. It counts in terminals opened from now on.");
            } else {
                ui::warn("the PATH wasn't changed");
            }
        }
        _ => unix_path(home, &bin, ui),
    }
}

fn unix_path(home: &Path, bin: &Path, ui: &Ui) {
    let Some(user) = system::home_dir() else {
        return;
    };
    // A link in ~/.local/bin, when that is on the PATH, as it often is on Linux.
    let local = user.join(".local/bin");
    if system::on_path(&local) {
        let link = local.join("framescript");
        let ours = std::fs::read_link(&link).is_ok_and(|to| to == launcher(home));
        if ours {
            return;
        }
        if link.symlink_metadata().is_err() {
            #[cfg(unix)]
            if std::os::unix::fs::symlink(launcher(home), &link).is_ok() {
                println!("Linked {} to it.", link.display());
                return;
            }
        } else {
            ui::warn(&format!(
                "{} is something else, which is left as it is",
                link.display()
            ));
        }
    }
    let shell = std::env::var("SHELL").unwrap_or_default();
    let shell = Path::new(&shell)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    let (profile, line) = match shell {
        "fish" => (
            user.join(".config/fish/conf.d/framescript.fish"),
            format!("fish_add_path {}", sh_quote(&bin.display().to_string())),
        ),
        "zsh" => (user.join(".zshrc"), export_line(bin)),
        "bash" if system::os() == Os::Mac => (user.join(".bash_profile"), export_line(bin)),
        "bash" => (user.join(".bashrc"), export_line(bin)),
        _ => (user.join(".profile"), export_line(bin)),
    };
    let text = std::fs::read_to_string(&profile).unwrap_or_default();
    if text.contains(&bin.display().to_string()) {
        println!(
            "{} has it already: it counts in terminals opened from now on.",
            profile.display()
        );
        return;
    }
    let question = format!(
        "Add {} to the PATH, with this line at the end of {}?\n  {line}",
        bin.display(),
        profile.display()
    );
    if !ui.confirm(&question) {
        println!("To have `framescript` in any terminal: {line}");
        return;
    }
    let appended = profile
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|_| {
            let mut text = text;
            if !text.is_empty() && !text.ends_with('\n') {
                text.push('\n');
            }
            text += &format!("# Added by create-framescript\n{line}\n");
            std::fs::write(&profile, text)
        });
    match appended {
        Ok(()) => println!("Added. It counts in terminals opened from now on."),
        Err(e) => ui::warn(&format!("{}: {e}", profile.display())),
    }
}

fn export_line(bin: &Path) -> String {
    format!(
        "export PATH={}:\"$PATH\"",
        sh_quote(&bin.display().to_string())
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_hold_whatever_is_in_them() {
        assert_eq!(
            sh_quote("/home/a/Application Support"),
            "'/home/a/Application Support'"
        );
        assert_eq!(sh_quote("it's"), "'it'\\''s'");
    }

    #[test]
    fn the_launcher_runs_the_current_version_with_the_downloaded_ffmpeg() {
        let home =
            std::env::temp_dir().join(format!("create-framescript-home-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        assert!(write_launcher(&home).is_err(), "nothing is installed");
        let binary = binary(&home, "2.0.1");
        std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
        std::fs::write(&binary, "").unwrap();
        set_current(&home, "2.0.1").unwrap();
        assert_eq!(current(&home).as_deref(), Some("2.0.1"));
        assert_eq!(installed(&home), ["2.0.1"]);

        let plain = std::fs::read_to_string(write_launcher(&home).unwrap()).unwrap();
        assert!(plain.contains(&binary.display().to_string()));
        assert!(!plain.contains("ffmpeg"), "{plain}");

        let ffmpeg = home.join("ffmpeg");
        std::fs::create_dir_all(ffmpeg.join("bin")).unwrap();
        std::fs::create_dir_all(ffmpeg.join("lib")).unwrap();
        std::fs::write(ffmpeg.join("bin").join(format!("ffmpeg{EXE}")), "").unwrap();
        let library = if cfg!(windows) {
            ffmpeg
                .join("bin")
                .join(format!("avcodec-{}.dll", ffmpeg::AVCODEC))
        } else {
            ffmpeg
                .join("lib")
                .join(format!("libavcodec.so.{}", ffmpeg::AVCODEC))
        };
        std::fs::write(library, "").unwrap();
        let with = std::fs::read_to_string(write_launcher(&home).unwrap()).unwrap();
        assert!(with.contains(&ffmpeg.display().to_string()), "{with}");
        if cfg!(unix) {
            assert!(with.contains("LD_LIBRARY_PATH"), "{with}");
        }
        let _ = std::fs::remove_dir_all(&home);
    }
}
