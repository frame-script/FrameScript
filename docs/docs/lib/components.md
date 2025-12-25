---
title: Core Components
sidebar_position: 2
---

This page lists the main primitives used in FrameScript projects.

## Project and Timeline

### `<Project>`

Root of the render tree. Provides a fixed render surface.

```tsx
import { Project } from "../src/lib/project"

export const PROJECT = () => (
  <Project>
    {/* scenes/clips */}
  </Project>
)
```

### `<TimeLine>`

Registers clips and visualizes them in the Timeline UI.

```tsx
import { TimeLine } from "../src/lib/timeline"

export const PROJECT = () => (
  <Project>
    <TimeLine>
      {/* Clip / ClipSequence */}
    </TimeLine>
  </Project>
)
```

## Clips

### `<Clip>`

Determines its length from children or the `duration` prop. Inactive clips are not rendered.

```tsx
<Clip label="Intro" duration={seconds(3.5)}>
  <IntroScene durationFrames={seconds(3.5)} />
</Clip>
```

### `<ClipSequence>`

Chains multiple `<Clip>` on a single lane. Start positions are calculated automatically.

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

Explicit start/end clip. Useful when you need strict boundaries.

```tsx
<ClipStatic start={0} end={119} label="Custom Range">
  <MyScene />
</ClipStatic>
```

### `<Serial>`

Utility to place `<ClipStatic>` elements back-to-back while preserving their length.

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

### `useCurrentFrame()`

Returns the current frame. Inside a `<Clip>`, the value is relative to the clip start.

```ts
// Current local frame
const currentFrame = useCurrentFrame()
// Current global frame
const globalCurrentFrame = useGlobalCurrentFrame()
```

### `seconds()`

Converts seconds to frames.

```ts
const introFrames = seconds(3.5)
```

## Layout

### `<FillFrame>`

Full-frame absolute container.

```tsx
<FillFrame>
  <Background />
  <Foreground />
</FillFrame>
```
