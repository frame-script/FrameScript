//! FFmpeg, which FrameScript reads videos and sounds with (its libraries, found at run time) and
//! exports with (its `ffmpeg` command). It has to be 9: AntiWebUI knows the layout of that
//! version's libraries only (libavcodec 63).
//!
//! It is the system's when that is 9 with its libraries; otherwise a build of FFmpeg-Builds is
//! downloaded into the home, which the launcher puts first on the paths. That one is GPL: it has
//! x264 and x265 for exporting, and FrameScript only runs it and loads it, which the GPL allows.

use crate::download;
use crate::system::{self, Os};
use std::path::{Path, PathBuf};

/// The major version of libavcodec that AntiWebUI reads.
pub const AVCODEC: u32 = 63;

const RELEASE: &str =
    "https://api.github.com/repos/FFmpeg-Builds/FFmpeg-Builds/releases/tags/latest";
pub const BUILDS: &str = "https://github.com/FFmpeg-Builds/FFmpeg-Builds";

const EXE: &str = std::env::consts::EXE_SUFFIX;

/// The system's FFmpeg, when it is 9 with its libraries: what it says it is, and where.
pub fn system() -> Result<String, String> {
    let program = system::find_program("ffmpeg").ok_or("there is no ffmpeg on the PATH")?;
    let text = system::output(&program, &["-hide_banner", "-version"])
        .ok_or_else(|| format!("{} doesn't run", program.display()))?;
    let version = text
        .lines()
        .next()
        .and_then(|l| l.strip_prefix("ffmpeg version "))
        .and_then(|l| l.split_whitespace().next())
        .unwrap_or("of an unknown version")
        .to_owned();
    match avcodec_major(&text) {
        Some(AVCODEC) => {}
        Some(major) => {
            return Err(format!(
                "{} is FFmpeg {version} (libavcodec {major}); FrameScript needs 9 (libavcodec {AVCODEC})",
                program.display()
            ));
        }
        None => return Err(format!("{} doesn't say its version", program.display())),
    }
    if !has_libraries(&program) {
        return Err(format!(
            "{} is FFmpeg {version}, but its libraries (libavcodec {AVCODEC}) aren't where they are looked for",
            program.display()
        ));
    }
    let mut found = format!("FFmpeg {version}, {}", program.display());
    let encoders = system::output(&program, &["-hide_banner", "-encoders"]).unwrap_or_default();
    if !encoders.contains("libx264") {
        found += " (without libx264: no H.264 exports)";
    }
    Ok(found)
}

/// `libavcodec     63.  1.102 / 63.  1.102` of `ffmpeg -version`.
fn avcodec_major(version: &str) -> Option<u32> {
    version.lines().find_map(|line| {
        line.trim()
            .strip_prefix("libavcodec")?
            .trim()
            .split('.')
            .next()?
            .trim()
            .parse()
            .ok()
    })
}

/// Whether the libraries of the `ffmpeg` at `program` are where AntiWebUI looks.
fn has_libraries(program: &Path) -> bool {
    match system::os() {
        Os::Linux => system::has_library(&format!("libavcodec.so.{AVCODEC}")),
        Os::Mac => {
            let name = format!("libavcodec.{AVCODEC}.dylib");
            let beside = program.parent().map(|bin| bin.join("../lib"));
            beside
                .into_iter()
                .chain(["/opt/homebrew/lib", "/usr/local/lib", "/opt/local/lib"].map(PathBuf::from))
                .any(|dir| dir.join(&name).exists())
        }
        // Found on the PATH, as the command was.
        Os::Windows => program
            .parent()
            .is_some_and(|dir| dir.join(format!("avcodec-{AVCODEC}.dll")).exists()),
        Os::Other => false,
    }
}

/// The FFmpeg downloaded into the home, when there is one.
pub fn bundled(home: &Path) -> Option<PathBuf> {
    let dir = home.join("ffmpeg");
    let library = if cfg!(windows) {
        dir.join("bin").join(format!("avcodec-{AVCODEC}.dll"))
    } else {
        dir.join("lib").join(format!("libavcodec.so.{AVCODEC}"))
    };
    (dir.join("bin").join(format!("ffmpeg{EXE}")).exists() && library.exists()).then_some(dir)
}

/// What FFmpeg-Builds calls this system, if it builds for it.
pub fn platform() -> Option<&'static str> {
    match (system::os(), std::env::consts::ARCH) {
        (Os::Linux, "x86_64") => Some("linux64"),
        (Os::Linux, "aarch64") => Some("linuxarm64"),
        (Os::Windows, "x86_64") => Some("win64"),
        (Os::Windows, "aarch64") => Some("winarm64"),
        _ => None,
    }
}

/// Of the files of a release, the newest FFmpeg 9 of the platform, with its libraries:
/// `ffmpeg-n9.0-latest-linux64-gpl-shared-9.0.tar.xz`.
fn pick<'a>(names: impl IntoIterator<Item = &'a str>, platform: &str) -> Option<&'a str> {
    let middle = format!("-latest-{platform}-gpl-shared-9.");
    names
        .into_iter()
        .filter_map(|name| {
            let rest = name.strip_prefix("ffmpeg-n9.")?;
            let (minor, tail) = rest.split_once(&middle)?;
            let minor: u32 = minor.parse().ok()?;
            let ext_ok = tail.ends_with(".tar.xz") || tail.ends_with(".zip");
            ext_ok.then_some((minor, name))
        })
        .max_by_key(|(minor, _)| *minor)
        .map(|(_, name)| name)
}

/// What `checksums.sha256` says of a file.
fn checksum<'a>(sums: &'a str, name: &str) -> Option<&'a str> {
    sums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        (parts.next()?.trim_start_matches('*') == name).then_some(hash)
    })
}

/// Downloads FFmpeg 9 into `home/ffmpeg`, checked against the sums of its release.
pub fn download(home: &Path) -> Result<(), String> {
    let platform = platform().ok_or("FFmpeg-Builds has no build for this system")?;
    let release = download::json(RELEASE)?;
    let assets = release["assets"]
        .as_array()
        .ok_or("the release of FFmpeg-Builds lists no files")?;
    let url_of = |name: &str| {
        assets
            .iter()
            .find(|a| a["name"] == name)
            .and_then(|a| a["browser_download_url"].as_str())
            .map(str::to_owned)
    };
    let names = assets.iter().filter_map(|a| a["name"].as_str());
    let name = pick(names, platform)
        .ok_or_else(|| format!("the release of FFmpeg-Builds has no FFmpeg 9 for {platform}"))?
        .to_owned();
    let sums_url = url_of("checksums.sha256").ok_or("the release of FFmpeg-Builds has no sums")?;
    let sums = download::text(&sums_url)?;
    let expected = checksum(&sums, &name)
        .ok_or_else(|| format!("checksums.sha256 says nothing of {name}"))?
        .to_ascii_lowercase();
    let url = url_of(&name).expect("picked from the list");
    println!("Downloading {name}");
    let file = home.join("downloads").join(&name);
    let got = download::file(&url, &file)?;
    if got != expected {
        let _ = std::fs::remove_file(&file);
        return Err(format!(
            "{name} isn't what its release says (SHA-256 {got}, not {expected})"
        ));
    }
    println!("Unpacking it");
    let unpacked = download::unpack(&file, &home.join("ffmpeg"));
    let _ = std::fs::remove_file(&file);
    // Only when nothing else is in it.
    let _ = std::fs::remove_dir(home.join("downloads"));
    unpacked?;
    bundled(home)
        .map(|_| ())
        .ok_or_else(|| format!("{name} doesn't have what was expected in it"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_major_version_is_read() {
        let text = "ffmpeg version n9.0.2 Copyright (c) 2000-2026 the FFmpeg developers\n\
                    libavutil      61.  1.102 / 61.  1.102\n\
                    libavcodec     63.  1.102 / 63.  1.102\n";
        assert_eq!(avcodec_major(text), Some(63));
        assert_eq!(
            avcodec_major("libavcodec     61. 19.100 / 61. 19.100"),
            Some(61)
        );
        assert_eq!(avcodec_major("nothing"), None);
    }

    #[test]
    fn the_newest_9_of_the_platform_is_picked() {
        let names = [
            "checksums.sha256",
            "ffmpeg-master-latest-linux64-gpl-shared.tar.xz",
            "ffmpeg-n8.1-latest-linux64-gpl-shared-8.1.tar.xz",
            "ffmpeg-n9.0-latest-linux64-gpl-shared-9.0.tar.xz",
            "ffmpeg-n9.0-latest-linux64-lgpl-shared-9.0.tar.xz",
            "ffmpeg-n9.1-latest-linux64-gpl-shared-9.1.tar.xz",
            "ffmpeg-n9.1-latest-linuxarm64-gpl-shared-9.1.tar.xz",
            "ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip",
            "ffmpeg-n9.0-latest-win64-gpl-9.0.zip",
        ];
        assert_eq!(
            pick(names, "linux64"),
            Some("ffmpeg-n9.1-latest-linux64-gpl-shared-9.1.tar.xz")
        );
        assert_eq!(
            pick(names, "win64"),
            Some("ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip")
        );
        assert_eq!(pick(names, "winarm64"), None);
    }

    #[test]
    fn a_sum_is_found_by_its_name() {
        let sums = "aaa  ffmpeg-n9.0-latest-linux64-gpl-shared-9.0.tar.xz\n\
                    bbb *ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip\n";
        assert_eq!(
            checksum(sums, "ffmpeg-n9.0-latest-win64-gpl-shared-9.0.zip"),
            Some("bbb")
        );
        assert_eq!(
            checksum(sums, "ffmpeg-n9.0-latest-linux64-gpl-shared-9.0.tar.xz"),
            Some("aaa")
        );
        assert_eq!(checksum(sums, "other"), None);
    }
}
