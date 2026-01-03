---
title: Animation
sidebar_position: 4
---

FrameScript controls the overall timing on `<TimeLine/>`, but it also provides a system for fine-grained animation state.

## Overview and example

```tsx
import { useAnimation, useVariable } from "../src/lib/animation"
import { BEZIER_SMOOTH } from "../src/lib/animation/functions"
import { FillFrame } from "../src/lib/layout/fill-frame"
import { seconds } from "../src/lib/frame"

const CircleScene = () => {
  // Store position and opacity as animatable variables
  const position = useVariable({ x: -300, y: 0 })
  const opacity = useVariable(0)

  const { ready } = useAnimation(async (ctx) => {
    // Create handles and wait for them in parallel
    const move = ctx.move(position).to({ x: 240, y: 0 }, seconds(1.2), BEZIER_SMOOTH)
    const fade = ctx.move(opacity).to(1, seconds(0.6), BEZIER_SMOOTH)
    await ctx.parallel([move, fade])
  }, [])

  // Avoid rendering before precomputation finishes
  if (!ready) return null

  // Read the value for the current frame
  const pos = position.use()

  return (
    <FillFrame style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: "999px",
          background: "#38bdf8",
          opacity: opacity.use(),
          transform: `translate(${pos.x}px, ${pos.y}px)`,
          boxShadow: "0 20px 60px rgba(56,189,248,0.35)",
        }}
      />
    </FillFrame>
  )
}
```

In this example, `useVariable` creates position and opacity, while `useAnimation` drives a move and a fade at the same time. Use `variable.use()` in JSX styles to bind the current-frame value.

![](./circle.gif)

## You can reorder awaits

`useAnimation` uses async/await for flow control. By changing the await order, you can decide when to wait even with the same motions.

```tsx
useAnimation(async (ctx) => {
  // Kick off a motion first
  const move = ctx.move(position).to({ x: 300, y: 0 }, seconds(1), BEZIER_SMOOTH)

  // Wait for something else first
  await ctx.sleep(seconds(0.4))

  // If move already progressed, this finishes immediately
  await move
}, [])
```

The key is that you can start motions early and await them later. That makes it easy to layer animations without complex bookkeeping.

## Effects: SpeedLines

`<SpeedLines />` is a focused-line overlay that reacts to the current frame and adds a subtle jitter.

```tsx
import { SpeedLines } from "../src/lib/animation/effect/speed-lines"
import { FillFrame } from "../src/lib/layout/fill-frame"

const Impact = () => (
  <FillFrame>
    <SpeedLines />
  </FillFrame>
)
```

## Effects: DrawText

`<DrawText />` renders text as animated SVG strokes using a supplied font file.

```tsx
import { useAnimation, useVariable } from "../src/lib/animation"
import { DrawText } from "../src/lib/animation/effect/draw-text"
import { seconds } from "../src/lib/frame"

const Title = () => {
  const progress = useVariable(0)

  useAnimation(async (context) => {
    await context.move(progress).to(1, seconds(2))
  })

  return <DrawText text="Hello" fontUrl="assets/Roboto.ttf" fontSize={96} progress={progress} />
}
```

## Effects: DrawTex

`<DrawTex />` renders TeX as animated SVG strokes (MathJax SVG output).
MathJax must be available in the build (this project uses a static import in `draw-text.tsx`).

```tsx
import { useAnimation, useVariable } from "../src/lib/animation"
import { DrawTex } from "../src/lib/animation/effect/draw-text"
import { seconds } from "../src/lib/frame"

const Formula = () => {
  const progress = useVariable(0)

  useAnimation(async (context) => {
    await context.move(progress).to(1, seconds(2))
  })

  return (
    <DrawTex tex={"\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}"} fontSize={96} progress={progress} />
  )
}
```
