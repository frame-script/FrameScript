# FrameScript2's documentation

A video is TSX: components that lay out boxes, text, pictures, videos, vector shapes and 3D scenes
with CSS, and move them with animations written as `async` scripts. A frame is a function of its
number, so the studio can seek anywhere at once and an export can draw frames on many threads.

Read [projects, commands and the studio](project.md) and [the one rule](reactivity.md) first:
the rest builds on them.

| | |
|---|---|
| [installing.md](installing.md) | `create-framescript`: what FrameScript needs, installing it, FFmpeg |
| [project.md](project.md) | a project's files, `framescript.json`, the commands, the studio |
| [reactivity.md](reactivity.md) | components run once; what changes is a function |
| [timeline.md](timeline.md) | `<Timeline>`, `<Clip>`, `<Sequence>`, frames, `useAnimation`, easings |
| [styles.md](styles.md) | elements, CSS properties, text shadows and strokes |
| [media.md](media.md) | `<img>`, `<Video>`, `<Audio>`, `<LipSync>` |
| [svg.md](svg.md) | vector shapes that change frame by frame, trim paths |
| [shaders.md](shaders.md) | `<Shader>`: WGSL for every pixel of a box |
| [3d.md](3d.md) | `framescript/3d`: scenes, models, lights, shadows, materials, effects |
| [export.md](export.md) | codecs, quality, size, and how frames are shared out |
| [checking.md](checking.md) | checking a video by rendering frames and looking at them (for AI agents) |
| [design/](design/00-overview.md) | how it works inside, and why (in Japanese) |

The library is `packages/framescript` (`index.ts` lists what it exports, `3d.ts` the 3D part), and
its types are the most exact reference there is. `examples/` has a project for each part.

## The repository

| | |
|---|---|
| `packages/framescript` | the TypeScript library: reactivity, JSX, styles, clips, animations |
| `crates/framescript-engine` | V8 + AntiWebUI: the ops, the command buffer, compositions, the preview worker |
| `crates/framescript-studio` | the `framescript` binary: the studio, `render` and `export` |
| `installer` | `create-framescript` |
| `examples/hello` | an example project (`tsc -p examples/hello` checks its types) |
| `examples/media` | pictures, videos and sound (run `./make-assets.sh` first) |
| `examples/lipsync` | two faces whose mouths follow their lines (run `./make-assets.sh` first) |
| `examples/3d`, `examples/model` | WGSL and scenes in 3D; a glTF model (run `./get-assets.sh` first) |
| `examples/showcase` | 40 s of all of it, cut to music made in code (run `./make-assets.sh` first) |
| `examples/motion` | 44 s of motion graphics in SVG and type, cut to music made in code (run `./make-assets.sh` first) |
