//! A new project: a title that comes up and goes, with what an editor and an AI agent need to know.
//!
//! Where FrameScript is differs from one computer to another, and the project says it in two places:
//! `tsconfig.json` (where the library's types are) and a part of `AGENTS.md` between [`START`] and
//! [`END`]. [`sync`] writes those again for the computer it runs on, and leaves the rest alone.

use crate::install;
use std::path::Path;

/// Where the part of `AGENTS.md` that is this computer's starts and ends.
const START: &str = "<!-- create-framescript: this computer -->";
const END: &str = "<!-- /create-framescript -->";
/// What a path of FrameScript's library ends with, in `tsconfig.json`.
const LIBRARY: &str = "/packages/framescript";

pub struct Size {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
}

/// Makes the project in `dir`, which must not be there or be empty, for `version` in `home`.
pub fn create(dir: &Path, size: &Size, home: &Path, version: &str) -> Result<(), String> {
    if std::fs::read_dir(dir).is_ok_and(|mut entries| entries.next().is_some()) {
        return Err(format!(
            "{} is there already, with something in it",
            dir.display()
        ));
    }
    let name = dir
        .canonicalize()
        .unwrap_or_else(|_| dir.to_owned())
        .file_name()
        .and_then(|n| n.to_str())
        .map_or_else(|| "untitled".to_owned(), str::to_owned);
    let files = files(&name, size, home, version);
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    for (file, text) in files {
        let path = dir.join(file);
        std::fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    Ok(())
}

/// A path as JSON and TypeScript take it, with `/`.
fn forward(path: &Path) -> String {
    path.display().to_string().replace('\\', "/")
}

fn files(name: &str, size: &Size, home: &Path, version: &str) -> Vec<(&'static str, String)> {
    let quoted = |s: &str| serde_json::to_string(s).expect("strings serialize");
    let settings = serde_json::json!({
        "name": name,
        "width": size.width,
        "height": size.height,
        "fps": size.fps,
        "entry": "main.tsx",
        "background": "#0b1020",
    });
    let pretty = |v: &serde_json::Value| serde_json::to_string_pretty(v).expect("JSON") + "\n";
    let main = MAIN.replace("{TITLE}", &quoted(name));
    let agents = AGENTS
        .replace("{NAME}", name)
        .replace("{FPS}", &format!("{}", size.fps.round()))
        .replace("{HERE}", &here(home, version));
    vec![
        ("framescript.json", pretty(&settings)),
        ("main.tsx", main),
        ("tsconfig.json", tsconfig(home, version)),
        (
            ".gitignore",
            "# What `framescript export` writes by default, and frames rendered to check.\nout/\ncheck/\n"
                .into(),
        ),
        ("AGENTS.md", agents),
        // Claude Code reads CLAUDE.md, which takes in AGENTS.md.
        ("CLAUDE.md", "@AGENTS.md\n".into()),
    ]
}

/// The library's path, as it is written in `tsconfig.json`: with `/`, and escaped for JSON.
fn library_in_json(home: &Path, version: &str) -> String {
    let path = forward(&install::library(home, version));
    let quoted = serde_json::to_string(&path).expect("strings serialize");
    quoted[1..quoted.len() - 1].to_owned()
}

fn tsconfig(home: &Path, version: &str) -> String {
    let library_ts = forward(&install::library(home, version));
    let tsconfig = serde_json::json!({
        "compilerOptions": {
            "target": "ES2022",
            "module": "ESNext",
            "moduleResolution": "bundler",
            "jsx": "react",
            "strict": true,
            "noEmit": true,
            "allowImportingTsExtensions": true,
            "lib": ["ES2022"],
            "types": [],
            "paths": { "framescript": [format!("{library_ts}/index.ts")] },
        },
        "include": ["**/*.ts", "**/*.tsx", format!("{library_ts}/**/*.ts")],
    });
    serde_json::to_string_pretty(&tsconfig).expect("JSON") + "\n"
}

/// The part of `AGENTS.md` that says where FrameScript is on this computer.
fn here(home: &Path, version: &str) -> String {
    let docs = install::docs(home, version);
    // The documentation is in docs/ in the releases after 2.0.1, and in the README before.
    let reference = if docs.ends_with("docs/README.md") {
        format!(
            "`{}`, the index of the documentation (read `project.md`, `reactivity.md` and \
             `timeline.md` there first)",
            docs.display()
        )
    } else {
        format!("`{}`", docs.display())
    };
    let source = install::source(home, version);
    // The releases after 2.0.1 have a map of the source for agents.
    let map = if source.join("AGENTS.md").exists() {
        " (its `AGENTS.md` maps it)"
    } else {
        ""
    };
    let antiwebui = match install::antiwebui(home, version) {
        Some(a) => match &a.checkout {
            Some(dir) => format!(
                "at commit `{}`, whose source is in `{}` (cargo's copy from the build, which cargo \
                 cleans up once it goes unused; then {})",
                a.revision,
                dir.display(),
                a.url
            ),
            None => format!("at commit `{}`: {}", a.revision, a.url),
        },
        None => {
            "https://github.com/bea4dev/AntiWebUI (the commit is in `Cargo.lock` of the source)"
                .into()
        }
    };
    HERE.replace("{START}", START)
        .replace("{SOURCE}", &source.display().to_string())
        .replace("{MAP}", map)
        .replace("{ANTIWEBUI}", &antiwebui)
        .replace("{END}", END)
        .replace("{VERSION}", version)
        .replace("{HOME}", &home.display().to_string())
        .replace("{LAUNCHER}", &install::launcher(home).display().to_string())
        .replace("{REFERENCE}", &reference)
        .replace(
            "{LIBRARY}",
            &install::library(home, version).display().to_string(),
        )
}

/// The version of FrameScript a project's `tsconfig.json` points at: `<tag>` of
/// `…/versions/<tag>/packages/framescript`.
pub fn version_of(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(dir.join("tsconfig.json")).ok()?;
    let before = &text[..text.find(LIBRARY)?];
    let tag = &before[before.rfind("/versions/")? + "/versions/".len()..];
    (!tag.is_empty() && !tag.contains(['/', '"', '\n'])).then(|| tag.to_owned())
}

/// What [`sync`] did.
pub struct Synced {
    /// How many paths of the library `tsconfig.json` had, which now are this computer's; `None`
    /// when it was written anew.
    pub tsconfig: Option<usize>,
    /// Whether `AGENTS.md` had a part of this computer's to write again.
    pub agents: bool,
}

/// Points the project in `dir` at FrameScript `version` in `home`: the library's paths in
/// `tsconfig.json`, and the part of `AGENTS.md` between [`START`] and [`END`]. The rest of them,
/// comments included, stays as it is; a missing `tsconfig.json` is written.
pub fn sync(dir: &Path, home: &Path, version: &str) -> Result<Synced, String> {
    if !dir.join("framescript.json").exists() {
        return Err(format!(
            "{} isn't a project: it has no framescript.json",
            dir.display()
        ));
    }
    let write = |name: &str, text: &str| {
        let path = dir.join(name);
        std::fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))
    };
    let tsconfig = match std::fs::read_to_string(dir.join("tsconfig.json")) {
        Ok(text) => {
            let (text, count) = repoint(&text, &library_in_json(home, version));
            write("tsconfig.json", &text)?;
            Some(count)
        }
        Err(_) => {
            write("tsconfig.json", &self::tsconfig(home, version))?;
            None
        }
    };
    let agents = match std::fs::read_to_string(dir.join("AGENTS.md")) {
        Ok(text) => match replace_part(&text, &here(home, version)) {
            Some(text) => {
                write("AGENTS.md", &text)?;
                true
            }
            None => false,
        },
        Err(_) => false,
    };
    Ok(Synced { tsconfig, agents })
}

/// In every string of `text` that has [`LIBRARY`] in it, puts `library` in place of what comes
/// before that, and returns how many there were. Nothing else changes, comments included.
fn repoint(text: &str, library: &str) -> (String, usize) {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    let mut count = 0;
    while let Some(at) = rest.find(LIBRARY) {
        let (before, after) = rest.split_at(at);
        match before.rfind('"') {
            // The start of the string, on the same line.
            Some(quote) if !before[quote..].contains('\n') => {
                out.push_str(&before[..=quote]);
                out.push_str(library);
                count += 1;
            }
            _ => {
                out.push_str(before);
                out.push_str(LIBRARY);
            }
        }
        rest = &after[LIBRARY.len()..];
    }
    out.push_str(rest);
    (out, count)
}

/// `text` with what is between [`START`] and [`END`], both included, replaced by `part`. `None`
/// when there is no such part.
fn replace_part(text: &str, part: &str) -> Option<String> {
    let start = text.find(START)?;
    let end = start + text[start..].find(END)? + END.len();
    Some(format!(
        "{}{}{}",
        &text[..start],
        part.trim_end(),
        &text[end..]
    ))
}

const MAIN: &str = r##"import { BEZIER_SMOOTH, Clip, FillFrame, seconds, Timeline, useAnimation, useVariable } from "framescript"

/** The video. `framescript.json` names this file, and this is what it shows. */
export default function Main() {
  return (
    <Timeline>
      <Clip label="title" duration={seconds(4)}>
        <Title />
      </Clip>
    </Timeline>
  )
}

/** A title that comes up, stays and goes. */
function Title() {
  const lift = useVariable(40)
  const opacity = useVariable(0)

  useAnimation(async (ctx) => {
    await ctx.parallel([
      ctx.move(lift).to(0, seconds(0.8), BEZIER_SMOOTH),
      ctx.move(opacity).to(1, seconds(0.6)),
    ])
    await ctx.sleep(seconds(2))
    await ctx.move(opacity).to(0, seconds(0.6))
  })

  return (
    <FillFrame>
      <text style={{ color: "#e2e8f0", fontSize: 96, fontWeight: "bold", opacity, translateY: lift }}>
        {{TITLE}}
      </text>
    </FillFrame>
  )
}
"##;

const AGENTS: &str = r#"# {NAME}

A video made with [FrameScript](https://github.com/frame-script/FrameScript): TSX that is laid out
and drawn frame by frame.

- `framescript.json`: the size, the frame rate, the entry module and the background.
- `main.tsx`: the entry. Its default export is what the video shows.
- `out/`: where exports go by default, and `check/`: frames rendered to check (not kept in git).

{HERE}

## Commands

`framescript` is FrameScript's command (where it isn't on the PATH, see above).

| | |
|---|---|
| `framescript render . --frame 60 --out frame.png` | draws frame 60 as a PNG |
| `framescript render . --frame 0 --frame 90 --out frame-{}.png` | several frames; `{}` is the number |
| `framescript export . --out out/{NAME}.mp4` | the whole video with its sound (needs FFmpeg) |
| `framescript .` | the studio: a window, for a person |

`framescript --help` says the rest: codecs, quality, size, a range of frames.

## Checking it

You can't watch the studio, and code that looks right often draws something else: text off the
frame, a box over another, an animation that ends in the wrong place, an empty clip. So check the
video yourself, by rendering frames and looking at the pictures, after every change and before you
say it is done. Renders go in `check/`.

```sh
# It loads (an error says its file and line, exit code 1), and how many frames it has.
framescript render . --frame 0 --out check/f-0.png
# The frames where things happen, small: the start and end of each clip and animation.
framescript render . --width 640 --frame 0 --frame 45 --frame 90 --out check/f-{}.png
# One a second ({FPS} fps, up to frame 600), in bash or zsh.
framescript render . --width 480 $(for f in $(seq 0 {FPS} 600); do printf -- '--frame %s ' $f; done) --out check/f-{}.png
# Motion: frames close together across a move.
framescript render . --width 480 --frame 30 --frame 34 --frame 38 --frame 42 --out check/m-{}.png
```

`--width` draws smaller, with the layout of the full size; look at the full size to judge whether
text is sharp and big enough. Look at every picture for:

- text cut off at the edges, or running out of its box, or too small or faint to read;
- things off the frame, or covered by others;
- frames that are empty where something should be, clips too long or too short;
- animations that end somewhere other than meant, or move at the wrong time;
- the picture against the sound: mouths, cuts on the beat, captions with their lines.

After exporting, check the file too (`ffmpeg` and `ffprobe` are FFmpeg's):

```sh
# Its length, its size, and whether it has sound.
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height -of compact out/{NAME}.mp4
# The whole video in one picture: a frame a second, 16 of them (fps=1/2: one every 2 seconds).
ffmpeg -v error -i out/{NAME}.mp4 -vf "fps=1,scale=320:-1,tile=4x4" -frames:v 1 -y check/sheet.png
# The picture at 12.5 seconds.
ffmpeg -v error -ss 12.5 -i out/{NAME}.mp4 -frames:v 1 -y check/at-12.5.png
```

Tell the person what you checked and what you saw.

## Writing it

The documentation and the library's types are where it says above.

- Components run once, as in SolidJS. What changes over time is a function or a variable
  (`useVariable`), handed over as it is: `style={{ opacity: () => frame() / 30 }}`. `frame()`
  read in JSX is read once, and doesn't change.
- Times are in frames. `seconds(n)` is `n` seconds at the project's rate.
- `<Clip>` is a layer, shown for its duration; `<Sequence>` puts clips one after another;
  `useAnimation(async (ctx) => …)` moves variables over time.
- A frame must not depend on the frames drawn before it: the studio seeks, and an export draws
  stretches of frames on several workers at once.
- Text is in `<text>`. Elements are `<div>`, `<text>`, `<img>` and `<svg>`, with CSS in camelCase
  (numbers are pixels), and the library's components (`<Video>`, `<Audio>`, `<Shader>`, …).
- Pictures, videos and sounds go in the project (`assets/`), and are found from its directory.
"#;

/// Written again by `create-framescript sync`, between its first line and its last.
const HERE: &str = r#"{START}
## On this computer

FrameScript {VERSION} is in `{HOME}`:

- `framescript` is `{LAUNCHER}` where it isn't on the PATH.
- The reference is {REFERENCE}.
- The library, with its types, is in `{LIBRARY}` (`tsconfig.json` points there); its `index.ts`
  lists what there is.
- FrameScript's own source, its Rust included, is in `{SOURCE}`{MAP}: `crates/` (the engine
  and the studio), `packages/framescript` (the library) and `docs/design/` (how it works and why,
  in Japanese).
- AntiWebUI, which lays the frames out and draws them, is {ANTIWEBUI}. Its `docs/design/` says how
  it works (in Japanese).

When the documentation doesn't say why something is drawn as it is, the source does.

These paths are of the computer the project was made on. If they aren't there (the project came
from another computer, or FrameScript was installed somewhere else), run `create-framescript sync .`:
it points this part and `tsconfig.json` at the FrameScript of the computer it runs on.
`create-framescript doctor --json` says where things are too (`launcher`, `library`, `docs`,
`source`, `antiwebui`).
{END}"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_files_say_what_they_should() {
        let home = Path::new("/home/a/.local/share/framescript");
        let size = Size {
            width: 1280,
            height: 720,
            fps: 30.0,
        };
        let files = files("my \"video\"", &size, home, "2.0.1");
        let get = |name: &str| &files.iter().find(|(n, _)| *n == name).unwrap().1;

        let settings: serde_json::Value = serde_json::from_str(get("framescript.json")).unwrap();
        assert_eq!(settings["name"], "my \"video\"");
        assert_eq!(settings["width"], 1280);
        assert_eq!(settings["fps"], 30.0);

        let tsconfig: serde_json::Value = serde_json::from_str(get("tsconfig.json")).unwrap();
        let path = tsconfig["compilerOptions"]["paths"]["framescript"][0]
            .as_str()
            .unwrap();
        assert!(
            path.ends_with("/versions/2.0.1/packages/framescript/index.ts"),
            "{path}"
        );

        assert!(
            get("main.tsx").contains(r#"{"my \"video\""}"#),
            "the title is a string"
        );
        assert!(get("AGENTS.md").contains("framescript render ."));
        assert!(
            get("AGENTS.md").contains("seq 0 30 600"),
            "one a second at the project's rate"
        );
        assert!(get(".gitignore").contains("check/"));
        assert!(!get("AGENTS.md").contains("{LAUNCHER}"));
        assert!(!get("AGENTS.md").contains("{REFERENCE}"));
        assert!(
            get("AGENTS.md").contains("/versions/2.0.1/README.md"),
            "no docs/ in it: the README"
        );
    }

    #[test]
    fn the_library_is_pointed_at_and_nothing_else_changes() {
        let text = r#"{
  // the editor's
  "compilerOptions": {
    "paths": { "framescript": ["C:/Users/a/AppData/Local/FrameScript/versions/2.0.1/packages/framescript/index.ts"] }
  },
  "include": ["**/*.tsx", "/home/a/.local/share/framescript/versions/2.0.1/packages/framescript/**/*.ts"]
}
"#;
        let (out, count) = repoint(
            text,
            "/Users/b/FrameScript/versions/2.0.2/packages/framescript",
        );
        assert_eq!(count, 2);
        assert!(
            out.contains(
                r#"["/Users/b/FrameScript/versions/2.0.2/packages/framescript/index.ts"]"#
            )
        );
        assert!(
            out.contains(r#""/Users/b/FrameScript/versions/2.0.2/packages/framescript/**/*.ts""#)
        );
        assert!(out.contains("// the editor's") && out.contains(r#""**/*.tsx""#));
        assert_eq!(repoint("{}", "/x").1, 0);
    }

    #[test]
    fn a_project_from_another_computer_is_pointed_here() {
        let root =
            std::env::temp_dir().join(format!("create-framescript-sync-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let dir = root.join("video");
        let size = Size {
            width: 1920,
            height: 1080,
            fps: 60.0,
        };
        create(&dir, &size, &root.join("there"), "2.0.1").unwrap();
        // What the person wrote in AGENTS.md stays.
        let agents =
            std::fs::read_to_string(dir.join("AGENTS.md")).unwrap() + "\n## Mine\n\nKeep this.\n";
        std::fs::write(dir.join("AGENTS.md"), agents).unwrap();

        let here = root.join("here");
        let synced = sync(&dir, &here, "2.0.2").unwrap();
        assert_eq!(synced.tsconfig, Some(2));
        assert!(synced.agents);
        let tsconfig = std::fs::read_to_string(dir.join("tsconfig.json")).unwrap();
        let agents = std::fs::read_to_string(dir.join("AGENTS.md")).unwrap();
        let there = forward(&root.join("there"));
        assert!(
            !tsconfig.contains(&there) && tsconfig.contains("/versions/2.0.2/packages/framescript")
        );
        assert!(
            !agents.contains(&there.replace('/', std::path::MAIN_SEPARATOR_STR)),
            "{agents}"
        );
        assert!(agents.contains("FrameScript 2.0.2 is in"));
        assert!(agents.contains("## Mine\n\nKeep this."));
        assert_eq!(agents.matches(START).count(), 1);

        assert_eq!(version_of(&dir).as_deref(), Some("2.0.2"));
        // Without tsconfig.json, it is written.
        std::fs::remove_file(dir.join("tsconfig.json")).unwrap();
        assert_eq!(sync(&dir, &here, "2.0.2").unwrap().tsconfig, None);
        assert!(dir.join("tsconfig.json").exists());
        assert!(sync(&root, &here, "2.0.2").is_err(), "not a project");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_project_isnt_made_over_another() {
        let dir =
            std::env::temp_dir().join(format!("create-framescript-project-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("main.tsx"), "mine").unwrap();
        let size = Size {
            width: 1920,
            height: 1080,
            fps: 60.0,
        };
        assert!(create(&dir, &size, Path::new("/nowhere"), "2.0.1").is_err());
        assert_eq!(
            std::fs::read_to_string(dir.join("main.tsx")).unwrap(),
            "mine"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
