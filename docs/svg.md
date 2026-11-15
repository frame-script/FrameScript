# Vector drawing

```tsx
import { linearGradient } from "framescript"

<svg viewBox="0 0 400 400" style={{ width: 800, height: 800 }}>
  <g transform={() => `rotate(${spin()} 200 200)`} fill="none" stroke="#ff4f4f" strokeWidth={12}>
    <circle cx={200} cy={200} r={radius} strokeLinecap="round" trim={() => [0, drawn()]} />
    <path d={() => star(5, 160, 70)} fill="linear-gradient(90deg, #ffc23d, #ee4231)" />
  </g>
  <rect x={40} y={340} width={320} height={24} rx={12} fill={linearGradient(["#2a5bd7", "#3ad6a6"])} />
</svg>
```

`<svg>` (with `viewBox` and `preserveAspectRatio`), `<g>`, `<path>`, `<circle>`, `<ellipse>`,
`<rect>`, `<line>`, `<polyline>` and `<polygon>` are drawn by AntiWebUI as shapes, not as a
picture: every attribute can be a function, `d` included, so a shape can change from frame to
frame. `fill` and `stroke` take colors, `"none"`, `"currentColor"`, CSS `linear-gradient(…)` /
`radial-gradient(…)` or `linearGradient` / `radialGradient` (SVG's, with `units`, `spread` and
`transform`); `strokeWidth`, `strokeLinecap`, `strokeLinejoin`, `strokeDasharray`,
`strokeDashoffset`, `pathLength`, `fillRule`, `opacity`, `vectorEffect` and `transform` are SVG's,
and go down from a group as they do there. They can be in `style` too. `trim={[start, end]}` is
FrameScript's own: only that part of the outline, in fractions of its length, is stroked (Trim
Paths); past 1 it goes on from the start. `clip={[x, y, width, height]}` on a `<g>` cuts what is
in it to a rectangle. Text goes over an `<svg>` in a `<text>`, as anywhere else.
