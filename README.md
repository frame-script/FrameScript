# FrameScript2

![](./docs/images/frame-script.gif)

Videos and motion graphics written in TSX, laid out and drawn by
[AntiWebUI](https://github.com/bea4dev/AntiWebUI) (wgpu, no browser), run in V8 through deno_core.

<a href="https://discord.gg/Gpjvht3BqM" data-size="large">
  <img alt="Discord" src="https://img.shields.io/discord/1454040226594033728.svg?label=Discord&logo=Discord&colorB=7289da&style=for-the-badge">
</a>

[日本語](./README.ja.md)

- Components and CSS, as on the web, with animations written as `async` scripts.
- A frame is a function of its number: the studio seeks anywhere at once, and an export draws
  frames on many threads.
- Videos, sound, lip sync, vector shapes, WGSL shaders, 3D scenes and glTF models.
- One native program with no browser in it: on Linux, and on Windows and macOS, whose support is
  new and less tried.

## Quick start with AI

An AI agent can install FrameScript, learn it, and make the video for you.

1. Install Rust: [rustup.rs](https://rustup.rs). On Windows, with Visual Studio's Build Tools
   ("Desktop development with C++").
2. Open an AI coding agent that can run commands and look at pictures, such as
   [Claude Code](https://claude.com/claude-code), in an empty directory. **Use a frontier model —
   Claude Opus or Claude Fable is strongly recommended.** Making a video means writing animation
   code, looking at the frames it renders and judging them, and doing that many times over; smaller
   models lose their way in it.
3. Tell it this, with your video in place of the last line:

   ```text
   Read https://raw.githubusercontent.com/frame-script/FrameScript/main/AGENTS.md and follow it.
   Install FrameScript, make a project named my-video here, and make this video.
   Render frames and look at them to check it before you say it is done.

   A 20-second intro for my channel "Night Coding": the title types itself in, ...
   ```

4. If something has to be installed with `sudo`, the agent will show you the command: run it
   yourself (in Claude Code, `! <command>`), and tell it to go on.
5. Watch it in the studio with `framescript my-video`, and ask the agent for changes. When it is
   right, ask it to export, or run `framescript export my-video`.

## Quick start

```sh
cargo install --git https://github.com/frame-script/FrameScript create-framescript
create-framescript my-video     # checks what is needed, installs FrameScript, makes the project
framescript my-video            # opens it in the studio
```

`create-framescript` asks before it installs anything (packages, FFmpeg 9); see
[installing](docs/installing.md). A project cloned from another computer is pointed at the
FrameScript on this one with `create-framescript sync <dir>`.

## Overview

A project is a directory with `framescript.json` and an entry module, whose default export is the
video:

```json
{ "name": "hello", "width": 1920, "height": 1080, "fps": 60, "entry": "main.tsx", "background": "#0b1020" }
```

```tsx
import { BEZIER_SMOOTH, Clip, FillFrame, seconds, Timeline, useAnimation, useVariable } from "framescript"

export default function Main() {
  return (
    <Timeline>
      <Clip label="intro" duration={seconds(3)}>
        <Intro />
      </Clip>
    </Timeline>
  )
}

function Intro() {
  const position = useVariable({ x: -300, y: 0 })
  const opacity = useVariable(0)

  useAnimation(async (ctx) => {
    await ctx.parallel([
      ctx.move(position).to({ x: 240, y: 0 }, seconds(1.2), BEZIER_SMOOTH),
      ctx.move(opacity).to(1, seconds(0.6)),
    ])
  })

  return (
    <FillFrame>
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: 999,
          background: "#38bdf8",
          opacity,                                       // a variable is followed as it is
          translate: () => [position().x, position().y], // and so is a function
        }}
      />
    </FillFrame>
  )
}
```

- **Components run once**, as in SolidJS. What changes over time is a function or a variable,
  and only what reads it is updated: `style={{ x: () => … }}` follows, `{frame()}` in JSX doesn't.
  See [the one rule](docs/reactivity.md).
- **Time is in frames.** `seconds(n)` turns seconds into frames. `useVariable` holds a value that
  `useAnimation` moves; awaiting a move moves the script's clock, not the program's.
- **Clips are layers.** `<Clip>` shows for its duration, with a frame of its own, and
  `<Sequence>` puts clips one after another.
- **Elements** are `<div>`, `<text>` (one run of text), `<img>` and `<svg>`, styled with CSS in
  camelCase; numbers are pixels. `<Video>`, `<Audio>`, `<Shader>` and `framescript/3d` add the rest.
- `framescript render my-video --frame 60 --out a.png` draws a frame, `framescript export
  my-video` writes the video, and `framescript my-video` opens the studio.

## Documentation

| | |
|---|---|
| [Installing](docs/installing.md) | `create-framescript`, what FrameScript needs, FFmpeg |
| [Projects, commands and the studio](docs/project.md) | the files, `framescript.json`, `render`, `export` |
| [The one rule](docs/reactivity.md) | components run once; what changes is a function |
| [Clips, frames and animations](docs/timeline.md) | `<Clip>`, `<Sequence>`, `useAnimation`, easings |
| [Styles](docs/styles.md) | elements, CSS, text shadows and strokes |
| [Pictures, videos and sound](docs/media.md) | `<img>`, `<Video>`, `<Audio>`, `<LipSync>` |
| [Vector drawing](docs/svg.md) | SVG shapes that change frame by frame |
| [WGSL](docs/shaders.md) | `<Shader>` |
| [3D](docs/3d.md) | scenes, glTF models, lights, shadows, materials |
| [Exporting](docs/export.md) | codecs, quality, size, workers |
| [Checking a video](docs/checking.md) | rendering frames and looking at them, as an AI agent does |
| [Design](docs/design/00-overview.md) | how it works inside, and why (in Japanese) |

## For AI agents

Start at [AGENTS.md](AGENTS.md): how to install FrameScript, make a project, and where each part is
documented. Then [docs/README.md](docs/README.md) and the pages it lists; the library's types are
in `packages/framescript` (`index.ts` and `3d.ts`). A project made by `create-framescript` has an
`AGENTS.md` of its own.

**An agent must check the video itself**, by rendering frames and looking at the pictures, after
every change and before it says the video is done: the code alone doesn't show where things end
up. [docs/checking.md](docs/checking.md) says how, from a single frame to the exported file.

## Building from source

```sh
cargo run --release -- examples/hello                        # the studio
cargo run --release -- render examples/hello -f 120 -o a.png # one frame as a PNG
cargo run --release -- export examples/hello -o hello.mp4    # the whole video
cargo test --workspace
```

The repository's layout is in [docs/README.md](docs/README.md#the-repository).
