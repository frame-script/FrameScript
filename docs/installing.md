# Installing

```sh
cargo install --git https://github.com/frame-script/FrameScript create-framescript
create-framescript my-video     # checks, installs FrameScript, and makes the project my-video
framescript my-video            # opens it
```

Rust is needed first: [rustup](https://rustup.rs). On Windows, with Visual Studio's Build Tools
("Desktop development with C++").

`create-framescript` (in `installer/`) looks at what FrameScript needs, and asks before it puts in
what is missing: packages with the system's package manager (pacman, apt, dnf, zypper, xbps, or
Homebrew on macOS), Rust's update, and FFmpeg 9. FFmpeg comes from pacman on Arch and from
Homebrew on macOS; elsewhere, where the system's is older, a build of
[FFmpeg-Builds](https://github.com/FFmpeg-Builds/FFmpeg-Builds) is downloaded, checked against the
sums of its release. Then it builds the latest release (or `--version`) from its source, once for
each version, and puts `framescript` on the PATH.

| | |
|---|---|
| `create-framescript doctor` | what is there and what is missing; changes nothing |
| `create-framescript install` | installs or updates FrameScript |
| `create-framescript new <dir> --width 1280 --height 720 --fps 30` | a project of that size |
| `create-framescript ffmpeg` | downloads FFmpeg 9 for FrameScript, even if the system has one |
| `create-framescript sync <dir>` | points a project from another computer at the FrameScript here |

Where FrameScript goes (`--home` or `FRAMESCRIPT_HOME` to choose):

| | |
|---|---|
| Linux | `~/.local/share/framescript` |
| macOS | `~/Library/Application Support/FrameScript` |
| Windows | `%LOCALAPPDATA%\FrameScript` |

In it, `versions/<tag>/` is the source of a release with its binary, `ffmpeg/` is FFmpeg when it was
downloaded, and `bin/framescript` runs the current version. Removing the directory removes
FrameScript.

## A project from another computer

Where FrameScript is differs from one computer to another (and from one system to another), and a
project made by `create-framescript` says it in two places: `tsconfig.json`, where the library's
types are for an editor, and the part of `AGENTS.md` between
`<!-- create-framescript: this computer -->` and `<!-- /create-framescript -->`. After cloning a
project onto another computer, `create-framescript sync <dir>` writes those again for it, and
leaves the rest of the files as they are. It uses the version the project was made for when that is
installed, and the current one otherwise (or `--version`).

## For programs and AI agents

- Without a terminal nothing is asked: what would have been is said, and the exit code is 2.
- `--yes` answers yes to everything; `--no-path` leaves the PATH and the shell's files alone.
- `doctor --json` says what is missing and how it is put in (packages, a command, a download, or
  something for a person to do), and where FrameScript's command, library, documentation and
  source are (`launcher`, `library`, `docs`, `source`), with the commit of AntiWebUI it is built
  with and where that source is (`antiwebui`).
- `sudo` can't ask for a password without a terminal: the packages' command is then said, for a
  person to run.
- A project has an `AGENTS.md` that tells an agent how to work on it.

## FFmpeg

FrameScript reads videos and sounds with FFmpeg's libraries, found when it runs, and exports with
its `ffmpeg` command. It has to be FFmpeg 9 (libavcodec 63). The build of FFmpeg-Builds is under the
GPL: FrameScript only runs it and loads it, and it isn't part of FrameScript.
