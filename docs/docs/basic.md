---
title: Basic
sidebar_position: 2
---

## Basic structure

Your project lives in `project/project.tsx`.
You build the video by adding elements here.

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
        {/* <Clip> is a timeline segment */}
        {/* Timeline length follows <Video/> by default (can be overridden) */}
        <Clip label="Clip Name">
          {/* <Video/> loads a video file */}
          <Video video={{ path: "~/Videos/example.mp4" }} />
        </Clip>
      </TimeLine>
    </Project>
  )
}
```
