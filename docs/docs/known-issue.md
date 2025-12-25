---
title: Render Known Issues
sidebar_position: 6
---

# Render Known Issues

## Prerequisites

- Rendering runs in headless Chromium (`chromiumoxide`).

## Known issues and workarounds

### 1) `backdrop-filter` (glass UI) causes missing or flickering pixels

**Symptoms**

- Parts of a panel disappear or flicker for a few frames.
- It can be reproducible around the same frame numbers.

**Likely cause**

- `backdrop-filter` samples the background and adds complex compositing.
- In headless Chromium, `backdrop-filter` combined with transforms can produce unstable tiles, and a mid-state is captured.

**Workarounds**

- Disable `backdrop-filter` only during render (most reliable).
  - In this repo, `GlassPanel` switches `backdrop-filter` to `none` while rendering.
- If you need maximum determinism, also avoid:
  - Heavy `filter: blur(...)` / `drop-shadow(...)`
  - Large transforms on elements with filters
