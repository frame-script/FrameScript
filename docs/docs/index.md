---
title: FrameScript Docs
sidebar_position: 1
---

FrameScript is a code-first motion graphics toolkit built on React, Electron, and Rust.
You author scenes as React components, preview them in the Studio UI, and render deterministic
video output through a headless Chromium pipeline.

## Quick start

1) Start the Studio UI (see project root scripts).
2) Edit `project/` components and scenes.
3) Use the Timeline panel to scrub, play, and verify clip timing.
4) Open **Render...** from the menu and export a video.

## Core concepts

- **Project**: Wraps the visual tree and provides a fixed render surface.
- **Timeline/Clips**: Clips register their time spans and are shown/hidden automatically.
- **Current frame**: All animation is derived from a single global frame counter.
- **Render mode**: When rendering, the app is driven by `window.__frameScript.setFrame`.

## Where to start

- `project/project.tsx` defines the main composition and clip order.
- `project/scenes/*` contains scene implementations.
- `src/lib/*` provides the clip, timeline, frame, and media primitives.

## Recommended reading

- Components and APIs: `components`
- Render pipeline: `rendering`
- Studio usage: `studio-usage`
