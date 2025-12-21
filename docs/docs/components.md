---
title: Components and APIs
sidebar_position: 4
---

This page documents the main primitives you use to build FrameScript projects.

## Project and timeline

### `<Project>`

Wraps the entire render tree and provides a fixed root size for composition.

```tsx
import { Project } from "../src/lib/project"

export const PROJECT = () => (
  <Project>
    {/* scenes/clips */}
  </Project>
)
```

### `<TimeLine>`

Manages clip registration so the Timeline UI can visualize ranges and visibility.

```tsx
import { TimeLine } from "../src/lib/timeline"

<TimeLine>
  {/* Clip / ClipSequence */}
</TimeLine>
```

## Clips

### `<Clip>`

Dynamic clip that derives duration from its children (via `useProvideClipDuration`) or
an explicit `duration` prop. When inactive, its contents are not rendered.

```tsx
<Clip label="Intro" duration={seconds(3.5)}>
  <IntroScene durationFrames={seconds(3.5)} />
</Clip>
```

### `<ClipSequence>`

Chains multiple `<Clip>`s back-to-back on a single lane. It rewrites each clip's start
position based on the previous clip's duration.

```tsx
<ClipSequence>
  <Clip label="Intro" duration={introFrames}>
    <IntroScene durationFrames={introFrames} />
  </Clip>
  <Clip label="Features" duration={featureFrames}>
    <FeaturesScene durationFrames={featureFrames} />
  </Clip>
</ClipSequence>
```

### `<ClipStatic>`

Explicit start/end clip. Useful when you want full control over clip boundaries.

```tsx
<ClipStatic start={0} end={119} label="Custom Range">
  <MyScene />
</ClipStatic>
```

### `<Serial>`

Utility to place `<ClipStatic>` elements back-to-back while preserving their lengths.

```tsx
<Serial>
  <ClipStatic start={0} end={89} label="A">
    <SceneA />
  </ClipStatic>
  <ClipStatic start={0} end={59} label="B">
    <SceneB />
  </ClipStatic>
</Serial>
```

## Frame utilities

### `WithCurrentFrame` and hooks

`WithCurrentFrame` provides the global frame context used by the renderer and Studio.

- `useCurrentFrame()` returns the local frame (relative to the clip start).
- `useGlobalCurrentFrame()` returns the project-global frame.
- `useSetGlobalCurrentFrame()` allows scrubbing or playback updates.

```tsx
import { WithCurrentFrame, useCurrentFrame } from "../src/lib/frame"

const Scene = () => {
  const f = useCurrentFrame()
  return <div style={{ opacity: f / 60 }}>Hello</div>
}

<WithCurrentFrame>
  <Scene />
</WithCurrentFrame>
```

### `seconds()`

Converts seconds to frames using the project FPS.

```ts
const introFrames = seconds(3.5)
```

## Layout

### `<FillFrame>`

Absolute full-frame container. Useful for backgrounds or full-screen layouts.

```tsx
<FillFrame>
  <Background />
  <Foreground />
</FillFrame>
```

## Media

### `<Video>`

Renders video frames via the backend. In Studio it uses a `<video>` tag; in render
mode it uses a canvas fed by the WebSocket decoder.

```tsx
import { Video } from "../src/lib/video/video"

<Video video="assets/demo.mp4" />
```

Use `trim` to crop the source:

```tsx
<Video video="assets/demo.mp4" trim={{ from: 30, duration: 120 }} />
```

### `<Sound>`

Plays audio in Studio and contributes segments to the render audio plan.

```tsx
import { Sound } from "../src/lib/sound/sound"

<Sound sound="assets/music.mp3" trim={{ trimStart: 30 }} />
```

## Render-aware behavior

### `useIsRender()`

Returns true when running in headless render mode. Use it to disable effects
that are unstable in headless Chromium (for example, `backdrop-filter`).

```tsx
const isRender = useIsRender()
return <div style={{ backdropFilter: isRender ? "none" : "blur(10px)" }} />
```
