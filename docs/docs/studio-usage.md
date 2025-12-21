---
title: Studio Usage
sidebar_position: 3
---

FrameScript Studio is the interactive UI for previewing and scrubbing your project.

## Layout overview

- **Clip list**: Toggle visibility of registered clips.
- **Preview**: Scaled project viewport with a fixed aspect ratio.
- **Timeline**: Clip ranges, playhead, and transport controls.

## Playing and scrubbing

- Use the transport controls to play/pause.
- Scrub the playhead directly in the timeline.
- The playhead position controls the global frame.

## Clip visibility

The Clip panel lets you hide or show clips. Visibility also applies to nested clips,
so hiding a parent clip hides all its children.

## Render dialog

From the app menu, choose **Render...** to open the render settings. The dialog
computes total frames based on your timeline and sends an audio plan before launching
the render process.

## Tips

- Keep the preview scale at 100% when judging crispness.
- Use short clips while iterating; extend durations when finalizing.
- If a scene looks fine in preview but glitches in render, use `useIsRender()` to
  disable compositor-heavy CSS.
