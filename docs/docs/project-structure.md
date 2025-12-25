---
title: Project Structure
sidebar_position: 2
---

The project is split into the Studio app and the content you author.
In most cases, you only need to edit `project/`.

## Key directories

- `project/`: Creative code (scenes, theme, components)
- `src/lib/`: Core primitives (Clip, Timeline, Frame, Media)
- `src/ui/`: Studio UI (timeline, transport, render dialogs)
- `backend/`: Rust decode server
- `render/`: Renderer that drives headless Chromium

## The main entry point

`project/project.tsx` defines the overall composition. You place scenes and clips here.

```tsx
<Project>
  <GlobalStyles />
  <TimeLine>
    <ClipSequence>
      <Clip label="Intro" duration={seconds(3.5)}>
        <IntroScene durationFrames={seconds(3.5)} />
      </Clip>
      {/* more clips */}
    </ClipSequence>
  </TimeLine>
</Project>
```
