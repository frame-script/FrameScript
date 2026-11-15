//! What this computer is, and running things on it.

use crate::ui::Ui;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Os {
    Linux,
    Mac,
    Windows,
    Other,
}

pub fn os() -> Os {
    match std::env::consts::OS {
        "linux" => Os::Linux,
        "macos" => Os::Mac,
        "windows" => Os::Windows,
        _ => Os::Other,
    }
}

/// The name of the system, as it says: `Arch Linux`, `macOS`, `Windows`.
pub fn name() -> String {
    match os() {
        Os::Linux => std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|release| {
                release
                    .lines()
                    .find_map(|l| l.strip_prefix("PRETTY_NAME="))
                    .map(|v| v.trim_matches('"').to_owned())
            })
            .unwrap_or_else(|| "Linux".into()),
        Os::Mac => "macOS".into(),
        Os::Windows => "Windows".into(),
        Os::Other => std::env::consts::OS.into(),
    }
}

/// The directory of the person's own files.
pub fn home_dir() -> Option<PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

/// Where a program is on the PATH.
pub fn find_program(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let suffixes: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
            .split(';')
            .map(str::to_owned)
            .collect()
    } else {
        vec![String::new()]
    };
    std::env::split_paths(&path).find_map(|dir| {
        suffixes
            .iter()
            .map(|suffix| dir.join(format!("{name}{suffix}")))
            .find(|candidate| is_program(candidate))
    })
}

fn is_program(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.is_file() && meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        meta.is_file()
    }
}

/// Whether a directory is one of the PATH's.
pub fn on_path(dir: &Path) -> bool {
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    let wanted = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_owned());
    std::env::split_paths(&path).any(|p| std::fs::canonicalize(&p).unwrap_or(p) == wanted)
}

/// What a program prints when it works.
pub fn output(program: impl AsRef<OsStr>, args: &[&str]) -> Option<String> {
    let out = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Whether a program works.
pub fn succeeds(program: impl AsRef<OsStr>, args: &[&str]) -> bool {
    Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// Runs a command in front of the person, who sees what it says and can answer it. Returns whether
/// it worked.
pub fn run(command: &[String]) -> bool {
    println!("$ {}", shown(command));
    match Command::new(&command[0]).args(&command[1..]).status() {
        Ok(status) => status.success(),
        Err(e) => {
            println!("can't run {}: {e}", command[0]);
            false
        }
    }
}

/// A command as it would be typed.
pub fn shown(command: &[String]) -> String {
    command
        .iter()
        .map(|part| {
            if part.contains([' ', '"', '\'']) {
                format!("'{}'", part.replace('\'', "'\\''"))
            } else {
                part.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_root() -> bool {
    cfg!(unix) && output("id", &["-u"]).is_some_and(|id| id.trim() == "0")
}

/// The package managers this knows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pm {
    Pacman,
    Apt,
    Dnf,
    Zypper,
    Xbps,
    Brew,
}

impl Pm {
    pub fn detect() -> Option<Pm> {
        match os() {
            Os::Mac => brew().map(|_| Pm::Brew),
            Os::Linux => [
                (Pm::Pacman, "pacman"),
                (Pm::Apt, "apt-get"),
                (Pm::Dnf, "dnf"),
                (Pm::Zypper, "zypper"),
                (Pm::Xbps, "xbps-install"),
            ]
            .into_iter()
            .find(|(_, program)| find_program(program).is_some())
            .map(|(pm, _)| pm),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Pm::Pacman => "pacman",
            Pm::Apt => "apt",
            Pm::Dnf => "dnf",
            Pm::Zypper => "zypper",
            Pm::Xbps => "xbps",
            Pm::Brew => "Homebrew",
        }
    }

    /// The commands that put `packages` in, in order. Without a terminal, `sudo` can't ask for a
    /// password, so it is told not to (and fails if it would).
    pub fn commands(self, packages: &[String], ui: &Ui) -> Vec<Vec<String>> {
        let sudo: Vec<String> = if self == Pm::Brew || is_root() {
            Vec::new()
        } else if ui.interactive() {
            vec!["sudo".into()]
        } else {
            vec!["sudo".into(), "-n".into()]
        };
        let with = |args: &[&str]| -> Vec<String> {
            let mut command = sudo.clone();
            command.extend(args.iter().map(|a| (*a).to_owned()));
            command.extend(packages.iter().cloned());
            command
        };
        match self {
            Pm::Pacman => vec![with(&["pacman", "-S", "--needed", "--noconfirm"])],
            Pm::Apt => {
                let mut update = sudo.clone();
                update.extend(["apt-get".into(), "update".into()]);
                vec![update, with(&["apt-get", "install", "-y"])]
            }
            Pm::Dnf => vec![with(&["dnf", "install", "-y"])],
            Pm::Zypper => vec![with(&["zypper", "--non-interactive", "install"])],
            Pm::Xbps => vec![with(&["xbps-install", "-Sy"])],
            Pm::Brew => {
                let brew = brew().map_or_else(|| "brew".into(), |b| b.display().to_string());
                let mut command = vec![brew, "install".into()];
                command.extend(packages.iter().cloned());
                vec![command]
            }
        }
    }
}

/// Homebrew's `brew`, which a new terminal has on the PATH but this one may not yet.
fn brew() -> Option<PathBuf> {
    find_program("brew").or_else(|| {
        ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]
            .into_iter()
            .map(PathBuf::from)
            .find(|p| is_program(p))
    })
}

/// Whether the dynamic linker finds a library by its name, like `libvulkan.so.1`. Linux only.
pub fn has_library(name: &str) -> bool {
    static CACHE: OnceLock<String> = OnceLock::new();
    let cache = CACHE.get_or_init(|| {
        ["ldconfig", "/sbin/ldconfig", "/usr/sbin/ldconfig"]
            .into_iter()
            .find_map(|program| output(program, &["-p"]))
            .unwrap_or_default()
    });
    let listed = cache.lines().any(|line| {
        line.trim_start()
            .strip_prefix(name)
            .is_some_and(|rest| rest.starts_with(' '))
    });
    listed || {
        let extra = std::env::var_os("LD_LIBRARY_PATH").unwrap_or_default();
        std::env::split_paths(&extra)
            .chain(
                [
                    "/usr/lib",
                    "/usr/lib64",
                    "/lib",
                    "/lib64",
                    "/usr/lib/x86_64-linux-gnu",
                    "/usr/lib/aarch64-linux-gnu",
                    "/usr/local/lib",
                ]
                .into_iter()
                .map(PathBuf::from),
            )
            .any(|dir| dir.join(name).exists())
    }
}

/// The makers of the GPUs. Linux only.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Vendor {
    Amd,
    Intel,
    Nvidia,
}

pub fn gpu_vendors() -> Vec<Vendor> {
    let mut vendors = Vec::new();
    let Ok(cards) = std::fs::read_dir("/sys/class/drm") else {
        return vendors;
    };
    for card in cards.flatten() {
        let Ok(id) = std::fs::read_to_string(card.path().join("device/vendor")) else {
            continue;
        };
        let vendor = match id.trim() {
            "0x1002" => Vendor::Amd,
            "0x8086" => Vendor::Intel,
            "0x10de" => Vendor::Nvidia,
            _ => continue,
        };
        if !vendors.contains(&vendor) {
            vendors.push(vendor);
        }
    }
    vendors
}

/// Whether some Vulkan driver says it is there. Linux only.
pub fn has_vulkan_driver() -> bool {
    let data_dirs = std::env::var("XDG_DATA_DIRS").unwrap_or_default();
    data_dirs
        .split(':')
        .filter(|d| !d.is_empty())
        .map(|d| Path::new(d).join("vulkan/icd.d"))
        .chain(
            [
                "/usr/share/vulkan/icd.d",
                "/usr/local/share/vulkan/icd.d",
                "/etc/vulkan/icd.d",
            ]
            .into_iter()
            .map(PathBuf::from),
        )
        .any(|dir| {
            std::fs::read_dir(dir).is_ok_and(|entries| {
                entries
                    .flatten()
                    .any(|e| e.path().extension().is_some_and(|x| x == "json"))
            })
        })
}
