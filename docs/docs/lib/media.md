---
title: Video and Audio
sidebar_position: 3
---

### `<Video>`

Places video with audio (you can mute if needed).
Studio uses a `<video>` tag; render mode uses WebSocket + Canvas.

```tsx
import { Video } from "../src/lib/video/video"

<Video video="assets/demo.mp4" />
```

You can trim the source in frames:

```tsx
<Video video="assets/demo.mp4" trim={{ from: 30, duration: 120 }} />
```

Waveform display in the timeline is automatic for clips shorter than 60 seconds.
For longer clips, set `showWaveform` to enable it explicitly:

```tsx
<Video video="assets/demo.mp4" showWaveform />
```

### `<Img>`

Image component that waits for decode before the headless renderer captures frames.

```tsx
import { Img } from "../src/lib/image"

<Img src="assets/intro.png" />
```

### `video_length`

Returns the length of a video in frames.

```tsx
const length = video_length({ path: "assets/demo.mp4" })
```

### `<Sound>`

Plays audio in Studio and applies it to the final render.

```tsx
import { Sound } from "../src/lib/sound/sound"

<Sound sound="assets/music.mp3" trim={{ trimStart: 30 }} />
```

Waveform display in the timeline is automatic for clips shorter than 60 seconds.
For longer clips, set `showWaveform` to enable it explicitly:

```tsx
<Sound sound="assets/music.mp3" showWaveform />
```

### `<Character>`

Switches between closed/open mouth images based on audio loudness.
If `clipLabel` is provided, it only reacts to audio inside clips with that label.

```tsx
import { Character } from "../src/lib/sound/character"

<Clip label="Voice">
  <Sound sound="assets/voice.mp3" />
</Clip>

<Character
  mouthClosed="assets/char_closed.png"
  mouthOpen="assets/char_open.png"
  threshold={0.12}
  clipLabel="Voice"
/>
```
