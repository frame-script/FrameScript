//! A new project: a title that comes up and goes, with what an editor and an AI agent need to know.

use crate::install;
use std::path::Path;

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
    let library = install::source(home, version).join("packages/framescript");
    let files = files(&name, size, &library, home, version);
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

fn files(
    name: &str,
    size: &Size,
    library: &Path,
    home: &Path,
    version: &str,
) -> Vec<(&'static str, String)> {
    let quoted = |s: &str| serde_json::to_string(s).expect("strings serialize");
    let settings = serde_json::json!({
        "name": name,
        "width": size.width,
        "height": size.height,
        "fps": size.fps,
        "entry": "main.tsx",
        "background": "#0b1020",
    });
    let library_ts = forward(library);
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
    let pretty = |v: &serde_json::Value| serde_json::to_string_pretty(v).expect("JSON") + "\n";
    let main = MAIN.replace("{TITLE}", &quoted(name));
    let launcher = install::launcher(home);
    let readme = install::source(home, version).join("README.md");
    let agents = AGENTS
        .replace("{NAME}", name)
        .replace("{VERSION}", version)
        .replace("{LAUNCHER}", &launcher.display().to_string())
        .replace("{README}", &readme.display().to_string())
        .replace("{LIBRARY}", &library.display().to_string());
    vec![
        ("framescript.json", pretty(&settings)),
        ("main.tsx", main),
        ("tsconfig.json", pretty(&tsconfig)),
        (
            ".gitignore",
            "# What `framescript export` writes by default.\nout/\n".into(),
        ),
        ("AGENTS.md", agents),
        // Claude Code reads CLAUDE.md, which takes in AGENTS.md.
        ("CLAUDE.md", "@AGENTS.md\n".into()),
    ]
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

A video made with [FrameScript](https://github.com/frame-script/FrameScript) {VERSION}: TSX that is
laid out and drawn frame by frame.

- `framescript.json`: the size, the frame rate, the entry module and the background.
- `main.tsx`: the entry. Its default export is what the video shows.
- `out/`: where exports go by default (not kept in git).

## Commands

`framescript` is `{LAUNCHER}` where it isn't on the PATH.

| | |
|---|---|
| `framescript render . --frame 60 --out frame.png` | draws frame 60 as a PNG |
| `framescript render . --frame 0 --frame 90 --out frame-{}.png` | several frames; `{}` is the number |
| `framescript export . --out out/{NAME}.mp4` | the whole video with its sound (needs FFmpeg) |
| `framescript .` | the studio: a window, for a person |

`framescript --help` says the rest: codecs, quality, size, a range of frames.

To see what a change does, render the frames it touches and look at them; reading the code isn't
enough to know where things end up.

## Writing it

The reference is `{README}`. The library, with its types, is in `{LIBRARY}`
(`tsconfig.json` points there).

- Components run once, as in SolidJS. What changes over time is a function or a variable
  (`useVariable`), handed over as it is: `style={{ opacity: () => frame() / 30 }}`. `frame()`
  read in JSX is read once, and doesn't change.
- Times are in frames. `seconds(n)` is `n` seconds at the project's rate.
- `<Clip>` is a layer, shown for its duration; `<Sequence>` puts clips one after another;
  `useAnimation(async (ctx) => …)` moves variables over time.
- Pictures, videos and sounds are found from the project's directory.
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_files_say_what_they_should() {
        let home = Path::new("/home/a/.local/share/framescript");
        let library = install::source(home, "2.0.1").join("packages/framescript");
        let size = Size {
            width: 1280,
            height: 720,
            fps: 30.0,
        };
        let files = files("my \"video\"", &size, &library, home, "2.0.1");
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
        assert!(!get("AGENTS.md").contains("{LAUNCHER}"));
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
