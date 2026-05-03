![](./frame-script.gif)

FrameScript is a video editing & motion graphics tool built with React + CSS.

<a href="https://discord.gg/Gpjvht3BqM" data-size="large">
  <img alt="Discord" src="https://img.shields.io/discord/1454040226594033728.svg?label=Discord&logo=Discord&colorB=7289da&style=for-the-badge">
</a>

[日本語.md](./README.ja.md)

## FrameScript features

- Build videos with web front-end technologies such as React + CSS
- Fine-grained animation control with the `useAnimation` API
- Efficient rendering system built in Rust

## Build videos with React

```tsx
import { Clip } from "../src/lib/clip"
import { Project, type ProjectSettings } from "../src/lib/project"
import { TimeLine } from "../src/lib/timeline"
import { Video } from "../src/lib/video/video"

// Project settings
export const PROJECT_SETTINGS: ProjectSettings = {
  name: "framescript-minimal",
  width: 1920,
  height: 1080,
  fps: 60,
}

// Project definition
// Add elements here to build the video
export const PROJECT = () => {
  return (
    <Project>
      <TimeLine>
        {/* <Clip> is an element displayed on the timeline */}
        {/* The timeline length reflects the <Video/> length (can be overridden) */}
        <Clip label="Clip Name">
          {/* <Video/> loads a video */}
          <Video video={{ path: "~/Videos/example.mp4" }} />
        </Clip>
      </TimeLine>
    </Project>
  )
}
```

## Animation API

With `useAnimation`, you can control animations in detail using `async/await`.

```tsx
import { useAnimation, useVariable } from "../src/lib/animation"
import { BEZIER_SMOOTH } from "../src/lib/animation/functions"
import { FillFrame } from "../src/lib/layout/fill-frame"
import { seconds } from "../src/lib/frame"

const CircleScene = () => {
  // Keep position and opacity as animatable variables
  const position = useVariable({ x: -300, y: 0 })
  const opacity = useVariable(0)

  useAnimation(async (ctx) => {
    // Run motions in parallel by creating handles
    const move = ctx
      .move(position)
      .to({ x: 240, y: 0 }, seconds(1.2), BEZIER_SMOOTH)
    const fade = ctx.move(opacity).to(1, seconds(0.6), BEZIER_SMOOTH)
    await ctx.parallel([move, fade])
  }, [])

  // Get values for the current frame
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

<img src="circle.gif" alt="circle_move" loop=infinite>

## QuickStart

(Requires Node.js)

```bash
npm init @frame-script/latest
cd <project-path>
npm run start
```

## Documentation

- [FrameScript Docs](https://frame-script.github.io/FrameScript/)
