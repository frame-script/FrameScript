---
title: Rendering Pipeline
sidebar_position: 5
---

FrameScript renders with a headless Chromium process and a Rust encoder.
This keeps the render deterministic while staying close to the Studio preview.

## High-level flow

1) The render binary launches headless Chromium.
2) Chromium loads `render.html` and your `PROJECT`.
3) The renderer sets a fixed frame via `window.__frameScript.setFrame(frame)`.
4) The page produces a screenshot per frame.
5) Rust writes frames into ffmpeg segments.
6) Segments are concatenated and optional audio is mixed.

## Frame driver

`WithCurrentFrame` exposes a `window.__frameScript` API:

- `setFrame(frame)` updates the global frame counter.
- `getFrame()` returns the current global frame.
- `waitCanvasFrame(frame)` allows video canvases to signal readiness.

The render binary waits for `setFrame` to exist, sets the frame, then optionally
awaits `waitCanvasFrame` before capturing the screenshot.

## Video frames

In render mode, `<Video>` uses a WebSocket to the backend (`/ws`) and requests
decoded frames by index. The backend uses ffmpeg to extract frames and caches them.

## Audio plan

`<Video>` and `<Sound>` register segments into a global audio plan. Before rendering,
the Studio sends this plan to the backend. After video frames are encoded, the
render process asks the backend for the plan and runs ffmpeg to mix audio onto the
final mp4.

## Render settings

The Render dialog lets you set:

- Output size (width/height)
- FPS and total frames
- Worker count (parallel Chromium instances)
- Encode (H264/H265) and preset
- Backend cache size

These settings are passed to the render binary as arguments.

## Reliability tips

- Avoid `backdrop-filter` or heavy filters during render (use `useIsRender()`).
- Avoid CSS animations that use wall-clock time; use `useCurrentFrame()` and
  drive animation state manually.
- For video-heavy scenes, ensure `waitCanvasFrame` is used so frames are ready.

See `RENDER_KNOWN_ISSUE` for more details.
