# FrameScript2

Videos and motion graphics written in TSX, laid out and drawn by
[AntiWebUI](../AntiWebUI) (wgpu, no browser), run in V8 through deno_core.

```sh
cargo run --release -- examples/hello                        # the studio
cargo run --release -- render examples/hello -f 120 -o a.png # one frame as a PNG
cargo run --release -- export examples/hello -o hello.mp4    # the whole video
```

In the studio: Space plays and pauses, ← / → step a frame (a second with Shift), Home / End go to
the ends, and pressing or dragging on the timeline seeks. The film button at the right of the
transport opens the export window. Saving a file of the project loads it
again.

## A project

A directory with `framescript.json` and an entry module (see `examples/hello`):

```json
{ "name": "hello", "width": 1920, "height": 1080, "fps": 60, "entry": "main.tsx", "background": "#0b1020" }
```

```tsx
import { BEZIER_SMOOTH, Clip, FillFrame, seconds, useAnimation, useVariable } from "framescript"

export default function Main() {
  return (
    <Clip label="intro">
      <Intro />
    </Clip>
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
          opacity,                                // a Variable is followed as it is
          translate: () => [position().x, position().y],
        }}
      />
    </FillFrame>
  )
}
```

### The one rule: functions are followed

Components run **once** (as in SolidJS, not React). What changes over time is written as a
function, and only the style property or text that reads it is sent again when it changes:

| | |
|---|---|
| `useCurrentFrame()` | an accessor: `frame()` is the frame relative to the clip |
| `useVariable(v)` | an accessor too: `opacity()`, or pass `opacity` as a style value |
| `style={{ x: value }}` | sent once |
| `style={{ x: () => … }}` | followed |
| `<text>{frame}</text>`, `<text>{() => …}</text>` | followed |
| `{frame()}` in JSX | read once, when the component runs: **not** followed |
| `<Show when={() => …}>`, `<For each={…}>` | conditional and keyed lists |

### Animations

`useAnimation(async (ctx) => …)` runs once, when the component is made, and doesn't wait for
anything: awaiting a handle moves the script's clock to its end. `ctx.move(v).to(value, frames,
easing)`, `ctx.move(v).set(value)`, `ctx.sleep(frames)`, `ctx.waitUntil(frame)`,
`ctx.waitUntilClip(label)` and `ctx.parallel(handles)` are those of FrameScript. What comes out is a
list of moves per variable, and the value at a frame is a pure function of the frame: seeking
anywhere is a binary search per variable, and a variable that doesn't move at the frame makes
nothing run.

### Clips

`<Clip start duration label>` is a layer over the frame, shown for its duration, with a frame of
its own. Without a duration it lasts as long as its animations and inner clips need (or the whole
project, if nothing in it says). `<Sequence>` puts its clips one after another.

### Pictures and videos

```tsx
<Clip label="photo" duration={seconds(3)}>
  <img src="assets/photo.png" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
</Clip>
<Clip label="interview">
  <Video src="assets/interview.mp4" trimStart={12} trimEnd={40} style={{ width: "100%", height: "100%" }} />
</Clip>
```

Paths are relative to the project. `<Video>` plays from the start of its clip, and the clip lasts
as long as the video unless it is given a duration; `playbackRate` changes its speed. Which frame
shows is a function of the frame, like everything else. Videos are decoded with the system's
FFmpeg, found at run time, on a thread per video, into a cache around where the playhead is:
playing goes on from frames decoded ahead, scrubbing back over them costs nothing, and the preview
shows the closest frame there is at once and the right one as soon as it is decoded. The cache
outlives reloads. `examples/media` shows both (`./make-assets.sh` makes its files with `ffmpeg`).

### Sound

```tsx
<Timeline>
  <Audio src="assets/music.m4a" volume={0.6} fadeIn={1} fadeOut={2} />
  <Clip label="interview">
    <Video src="assets/interview.mp4" volume={(frame) => (frame < 30 ? frame / 30 : 1)} />
  </Clip>
</Timeline>
```

`<Audio>` plays from the start of its clip (or of the project) and takes `trimStart`, `trimEnd`
and `playbackRate` as `<Video>` does; a `<Video>` plays its own sound unless it is `muted`.
`volume` is a number, or a function of the frame of the clip, which is called for every frame
once when the project loads (it can't follow signals); `fadeIn` / `fadeOut` are in seconds.
Sound isn't made frame by frame: the engine mixes it from where each piece is. In the studio the
sound is the clock while playing, so the picture keeps to what is heard, and moving the playhead
by hand lets a moment of it be heard. It goes out through ALSA (PipeWire and PulseAudio take that
in); `ANTIWEBUI_AUDIO_DEVICE=none` turns it off.

### WGSL

```tsx
import plasma from "./plasma.wgsl"

<Shader wgsl={plasma} uniforms={{ low: "#0f172a", high: "#7c3aed", speed: 0.8 }}
  style={{ width: "100%", height: "100%" }}>
  <text>over it</text>
</Shader>
```

```wgsl
struct Uniforms { low: vec4f, high: vec4f, speed: f32 }
@group(1) @binding(0) var<uniform> u: Uniforms;

fn shade(uv: vec2f) -> vec4f {
    let wave = sin(uv.x * 10.0 + fs.time * u.speed);
    return mix(u.low, u.high, 0.5 + 0.5 * wave);
}
```

`<Shader>` is a box (300 by 150 unless styled, as `<canvas>`) whose every pixel `shade(uv)` gives,
as light with straight alpha; `uv` goes from (0, 0) at the top left to (1, 1) at the bottom right.
A `@fragment` of its own can stand in for `shade`. FrameScript adds `fs`: `fs.time` (seconds into
the clip), `fs.frame` and `fs.resolution`. What the shader is given goes in `@group(1)`: one
uniform buffer, whose members are set by name in `uniforms` (numbers, lists, `{ x, y, z }`, or CSS
colors, which arrive as light), `texture_2d<f32>`s set by name in `textures` (files of the project),
and any `sampler`s. A `.wgsl` file imports as its code. The code is compiled with naga when the
project loads, and what is wrong with it is an error of the project, at its file and line, as is a
uniform that isn't there.

### 3D

```tsx
import { Box, DirectionalLight, PerspectiveCamera, Plane, Scene3D, orbit } from "framescript/3d"

<Scene3D style={{ width: "100%", height: "100%" }} background="#0b1020">
  <PerspectiveCamera position={() => orbit({ radius: 7, angle: frame(), height: 3 })} lookAt={[0, 0.5, 0]} />
  <DirectionalLight position={[4, 6, 3]} intensity={1.2} />
  <Plane size={20} rotation={[-90, 0, 0]} material={{ color: "#1e293b", roughness: 0.9 }} />
  <Box size={1.5} position={lift} rotation={() => [0, frame() * 1.5, 0]} material={{ color: "#38bdf8" }} />
  <text style={{ position: "absolute", left: 64, top: 48 }}>over the scene</text>
</Scene3D>
```

`<Scene3D>` is a box like any other; the things in 3D in it are drawn in it, and anything else is
laid over it. Y is up; rotations are in degrees about X, then Y, then Z; every value can be a
function or a `Variable`, as in styles (`ctx.move(position).to({ x, y, z })` moves a thing). There
are `Group`, `Box`, `Sphere`, `Plane`, `Cylinder`, `Cone`, `Torus` and `Mesh` (a shape of your own:
positions, normals, uvs, indices), `PerspectiveCamera` and `OrthographicCamera` (the last of those
that are `active` is used), and `AmbientLight`, `HemisphereLight`, `DirectionalLight`, `PointLight`
and `SpotLight`. Without a camera the scene is seen from `[0, 0, 5]`; without lights, by a soft
default light. A `<Clip>` in a scene is a group that shows while the clip does.

A `DirectionalLight` or a `SpotLight` with `castShadow` casts shadows (up to four lights of a
scene); every mesh casts and receives them unless it says `castShadow={false}` or
`receiveShadow={false}`. A directional light's shadow map covers what casts shadows, wherever it
is, so there is nothing to tune; its edges are softened over a few texels.

Materials are physically based (`color`, `metalness`, `roughness`, `emissive`, `opacity`, `map`),
and lit surfaces are tone mapped (`toneMapping`: `"neutral"`, the default, `"aces"` or `"none"`);
the background and colors a material gives itself come out as they are given. A material can be
WGSL of its own (`material={{ wgsl: hologram, uniforms: { tint: "#22d3ee" } }}`): `surface(in)`
returns the `Surface` at a point (start from `default_surface(in)`), `fragment(in)` returns a color
with no light at all, and `vertex(v)` moves the vertices (a `Plane` with `segments` has some to move).
`examples/3d` has all of it.

The scene is drawn by whatever draws the frame, on its own GPU device: the preview on the UI thread,
each worker of an export on its own. Only what changed is sent from the script, and the scene is
handed to the renderer as a snapshot, so a frame of 3D is a function of its number like the rest.

### Exporting

The export window in the studio, or `framescript export <project>` (see `--help`), writes the
video with its sound through the system's `ffmpeg` (or `FRAMESCRIPT_FFMPEG`): H.264, H.265 or AV1
in MP4, ProRes 422 HQ in MOV, and H.264 / H.265 on the GPU through VA-API where that works. It
takes a quality (CRF), a speed, a size (50–200% of the project's; more than 100% draws it larger,
as sharp as at its size), the frames to write and how many are drawn at once.

Since a frame is a pure function of its number, the frames are shared out among workers, each with
a V8, a document, a GPU device and an encoder of its own: each goes through a stretch of the frames
in order (its videos decode in order), and one that is done first takes the second half of what
another has left. The pieces are joined as they are, and the sound is mixed from the same plan as
in the preview. Pictures become YUV 4:2:0 (BT.709) on the GPU, so the encoder has nothing to
convert. More workers help when drawing is what takes the time; when the encoder is, they can't.

### Styles

CSS properties in camelCase; numbers are pixels. Shorthands (`padding: "8px 16px"`, `border`,
`borderRadius`, `gap`, `flex`, `inset`), `transform` (`translate`, `scale`, `rotate`) and the
separate `translate` / `scale` / `rotate`, `boxShadow`, `filter: blur()`, colors (`#hex`,
`rgb()`, `hsl()`, names), `objectFit` / `objectPosition` for pictures and videos. Elements are
`<div>`, `<text>` (one run of text) and `<img>`. What goes over what is as in CSS: what is
positioned (`position: "relative"` or `"absolute"`) or translucent or transformed goes over the
rest in the order it is written, and `zIndex` (for what is positioned and for flex items) orders
it further. `relative` doesn't move anything with `top` / `left`.

## Layout

| | |
|---|---|
| `packages/framescript` | the TypeScript library: reactivity, JSX, styles, clips, animations |
| `crates/framescript-engine` | V8 + AntiWebUI: the ops, the command buffer, compositions, the preview worker |
| `crates/framescript-studio` | the `framescript` binary: the studio and `render` |
| `examples/hello` | an example project (`tsc -p examples/hello` checks its types) |
| `examples/media` | pictures, videos and sound (run `./make-assets.sh` first) |

How it works, and why, is in [docs/design](docs/design/00-overview.md).
