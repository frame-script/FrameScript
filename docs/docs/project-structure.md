---
title: Project Structure
sidebar_position: 2
---

This project has two parts: the Studio app and the content you author.

## Key directories

- `project/`: Your creative code (scenes, theme, components).
- `src/lib/`: Core primitives (clip, timeline, frame, media).
- `src/ui/`: Studio UI (timeline, transport, render dialogs).
- `backend/`: Rust backend for video/audio decode.
- `render/`: Rust renderer that drives headless Chromium.

## Editing your project

Your main composition lives in `project/project.tsx`:

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

Scenes go under `project/scenes/` and can use any React-based layout.

## Theme and globals

- `project/theme.ts` defines your palette.
- `project/styles.tsx` defines global CSS and keyframes.
- `project/components/` is a good home for shared UI pieces.
