---
title: FrameScript Docs
sidebar_position: 1
---

FrameScript is a code-first motion graphics and video editing toolkit built with React and CSS.
You author scenes as React components, preview them in Studio, and render video through headless Chromium.

## Quick start

### Dependencies

:::tip
FrameScript requires [`Node.js`](https://nodejs.org/en).

On macOS, we recommend installing it via [`brew`](https://brew.sh/).
:::

### Create a project

Run the following command in any directory:

```bash
npm init @frame-script/latest
```

Move into the created directory:

```bash
cd <project-path>
```

Then start the Studio:

```bash
npm run start
```

FrameScript Studio should launch.

### Edit the project

Your project lives in `project/project.tsx`.
