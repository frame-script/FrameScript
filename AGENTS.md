# FrameScript2, for AI agents

FrameScript2 makes videos and motion graphics from TSX. A project is a directory with
`framescript.json` (size, frame rate, entry module) and the entry module, whose default export is
the video. It is laid out with CSS and drawn by AntiWebUI (wgpu, no browser); the script runs in
V8. A frame is a function of its number.

Paths below are from the root of the repository. From outside it, the same files are at
`https://raw.githubusercontent.com/frame-script/FrameScript/main/<path>`, and in an installed
FrameScript at `<home>/versions/<tag>/<path>` (`create-framescript doctor` says where the home is).

## Making a video for someone

1. **Install.** `cargo install --git https://github.com/frame-script/FrameScript create-framescript`
   (Rust has to be there: https://rustup.rs). Then `create-framescript doctor --json` says what is
   missing and how it is put in; tell the person what will be installed.
2. **Make the project.** `create-framescript <dir> --yes --no-path` puts in what is missing,
   builds FrameScript (10–30 minutes the first time) and makes the project. Exit code 2 means
   something is still missing: what to do is in its output. Packages need `sudo`, which can't ask
   for a password without a terminal; give the person the command it shows, and go on once they
   have run it. `framescript` is `<home>/bin/framescript` until a new terminal has it on the PATH.
   A project that came from another computer (its paths to FrameScript aren't there) is pointed at
   the FrameScript here with `create-framescript sync <dir>`.
3. **Learn it.** Read [docs/project.md](docs/project.md), [docs/reactivity.md](docs/reactivity.md)
   and [docs/timeline.md](docs/timeline.md), then the pages for what the video needs (below). The
   project's own `AGENTS.md` says where its version's documentation and types are.
4. **Write it**, in the entry module and the files it imports. Pictures, videos and sounds go in
   the project (`assets/`), and paths to them are from the project's directory.
5. **Check it yourself** after every change, by rendering frames and looking at them (below).
   Don't say the video is done until you have.
6. **Export** with `framescript export <dir>` (`<dir>/out/<name>.mp4`) when the person wants the
   file, and check the file too. `framescript <dir>` opens the studio, a window for the person to
   watch it in.

## Checking the video

You can't watch the studio, and code that looks right often draws something else: text off the
frame, a box over another, an animation that ends in the wrong place, an empty clip. So look at
the video yourself. The whole procedure is [docs/checking.md](docs/checking.md); in short, with
renders in `check/`:

```sh
# It loads (an error says its file and line, exit code 1), and how many frames it has.
framescript render . --frame 0 --out check/f-0.png
# The frames where things happen, small: the start and end of each clip and animation.
framescript render . --width 640 --frame 0 --frame 45 --frame 90 --out check/f-{}.png
# One a second (60 fps, up to frame 600).
framescript render . --width 480 $(for f in $(seq 0 60 600); do printf -- '--frame %s ' $f; done) --out check/f-{}.png
# Motion: frames close together across a move.
framescript render . --width 480 --frame 30 --frame 34 --frame 38 --frame 42 --out check/m-{}.png
# After exporting: length, size, sound, and the whole video in one picture.
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height -of compact out/video.mp4
ffmpeg -v error -i out/video.mp4 -vf "fps=1,scale=320:-1,tile=4x4" -frames:v 1 -y check/sheet.png
```

Then look at every picture: text cut off or too small to read, things off the frame or covered,
empty frames, animations that end in the wrong place or at the wrong time, and the picture against
the sound. Tell the person what you checked and what you saw.

## What is easy to get wrong

- Components run **once**, as in SolidJS, not React. What changes over time is a function or a
  variable, handed over as it is: `style={{ opacity: () => frame() / 30 }}`. `{frame()}` in JSX is
  read once and never changes. `<Show when>` and `<For each>` for conditions and lists.
- Times are frames. `seconds(n)` is `n` seconds in frames.
- `useAnimation(async (ctx) => …)` runs once; awaiting a move advances the script's own clock to
  its end. `ctx.parallel([...])` for moves at the same time.
- A frame must not depend on the frames drawn before it: the studio seeks, and an export draws
  stretches of frames on several workers at once.
- Text is in `<text>` (one run of text). Elements are `<div>`, `<text>`, `<img>`, `<svg>`, and the
  components of the library. Styles are CSS in camelCase; numbers are pixels.
- Videos, sounds and exporting need FFmpeg 9 (`create-framescript doctor`).

## The documentation

| | |
|---|---|
| [docs/README.md](docs/README.md) | the index, and the repository's layout |
| [docs/installing.md](docs/installing.md) | `create-framescript`: options, where things go, FFmpeg |
| [docs/project.md](docs/project.md) | a project's files, `framescript.json`, `render` / `export` options, the studio |
| [docs/reactivity.md](docs/reactivity.md) | the one rule: what is followed and what is read once |
| [docs/timeline.md](docs/timeline.md) | clips, sequences, frames, `useVariable`, `useAnimation`, easings |
| [docs/styles.md](docs/styles.md) | elements, CSS properties, stacking, text shadows and strokes |
| [docs/media.md](docs/media.md) | pictures, `<Video>`, `<Audio>`, `<LipSync>`, `useVoiceLevel` |
| [docs/svg.md](docs/svg.md) | `<svg>` shapes, gradients, trim paths |
| [docs/shaders.md](docs/shaders.md) | `<Shader>` and WGSL |
| [docs/3d.md](docs/3d.md) | `framescript/3d`: scenes, cameras, lights, shadows, materials, models, panels, effects |
| [docs/export.md](docs/export.md) | codecs, quality, size, workers |
| [docs/checking.md](docs/checking.md) | checking a video by rendering frames and looking at them |
| [docs/design/](docs/design/00-overview.md) | how it works inside, and why (in Japanese) |

The most exact reference is the library's types: `packages/framescript/index.ts` (and `3d.ts`).
`examples/` has a project for each part: `hello`, `media`, `lipsync`, `3d`, `model`, `showcase`,
`motion`.

## Working on FrameScript itself

| | |
|---|---|
| `packages/framescript` | the TypeScript library |
| `crates/framescript-engine` | V8 + AntiWebUI: ops, compositions, the preview worker, export |
| `crates/framescript-studio` | the `framescript` binary |
| `installer` | `create-framescript`, a workspace of its own |

```sh
cargo test --workspace
cargo clippy --workspace --tests --examples
cargo run --release -- render examples/hello -f 120 -o a.png
(cd installer && cargo test)
```

AntiWebUI is another repository (https://github.com/bea4dev/AntiWebUI); `Cargo.toml` says how to
build with a checkout of it. Why things are as they are is in `docs/design/` (in Japanese).
