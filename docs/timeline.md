# Clips, frames and animations

## Clips

```tsx
<Timeline>
  <Sequence>
    <Clip label="intro"><Intro /></Clip>
    <Clip label="cards"><Cards /></Clip>
    <Clip label="outro" duration={seconds(2)}><Outro /></Clip>
  </Sequence>
  <Clip label="overlay"><FrameCounter /></Clip>
</Timeline>
```

`<Clip start duration label>` is a layer over the frame, shown for its duration, with a frame of
its own. Without a duration it lasts as long as its animations and inner clips need (or the whole
project, if nothing in it says). `<Sequence>` puts its clips one after another. `<Timeline>` is
the root of the clips; it is only there to be read, and clips work without it. The label names a
clip in the studio's timeline, and for `ctx.waitUntilClip(label)` and `<LipSync clip>`.

`<FillFrame>` is a box over the whole frame (or the box it is in), its children centered unless
it is styled otherwise.

## Frames

Times are in frames. `seconds(n)` is `n` seconds in frames, at the project's rate, and
`framesToSeconds(f)` is the other way.

| | |
|---|---|
| `useCurrentFrame()` | the frame, from the start of the clip the caller is in |
| `useGlobalCurrentFrame()` | the frame, from the start of the project |
| `useClip()` | the clip the caller is in |
| `project` | the settings of `framescript.json` |

## Animations

```tsx
const position = useVariable({ x: -300, y: 0 })
const opacity = useVariable(0)

useAnimation(async (ctx) => {
  await ctx.parallel([
    ctx.move(position).to({ x: 240, y: 0 }, seconds(1.2), BEZIER_SMOOTH),
    ctx.move(opacity).to(1, seconds(0.6)),
  ])
  await ctx.sleep(seconds(1))
  await ctx.move(opacity).to(0, seconds(0.4))
})
```

`useVariable(value)` is a value that animations move: a number, `{ x, y }`, `{ x, y, z }` or a
color (`"#38bdf8"`). It is an accessor, and can be given to a style as it is.

`useAnimation(async (ctx) => …)` runs once, when the component is made, and doesn't wait for
anything: awaiting a handle moves the script's clock to its end. `ctx.move(v).to(value, frames,
easing)`, `ctx.move(v).set(value)`, `ctx.sleep(frames)`, `ctx.waitUntil(frame)`,
`ctx.waitUntilClip(label)` and `ctx.parallel(handles)` are those of FrameScript. What comes out is a
list of moves per variable, and the value at a frame is a pure function of the frame: seeking
anywhere is a binary search per variable, and a variable that doesn't move at the frame makes
nothing run.

Easings: `BEZIER_SMOOTH`, `BEZIER_SHARP`, `BEZIER_ACCELERATE`, `BEZIER_DECELERATE`,
`BEZIER_SNAPPY`, `BEZIER_OVERSHOOT` (`_SOFT`, `_HARD`), CSS's `BEZIER_EASE`, `BEZIER_EASE_IN`,
`BEZIER_EASE_OUT`, `BEZIER_EASE_IN_OUT` and `BEZIER_LINEAR`, `easeOutCubic`, `easeInOutCubic`,
`easeOutExpo`, and `cubicBezier(x1, y1, x2, y2)` for others. `lerp`, `clamp`, `mixColor`,
`frameProgress`, `fadeInOut` and `stagger` help with values of your own.
