# WGSL

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
