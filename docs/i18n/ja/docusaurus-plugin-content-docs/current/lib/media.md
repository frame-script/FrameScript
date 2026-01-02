---
title: 動画とサウンド
sidebar_position: 3
---

### `<Video>`

動画を音声とともに配置します（ミュート可能）。
Studio では `<video>`、レンダー時は WebSocket + Canvas で再生します。

```tsx
import { Video } from "../src/lib/video/video"

<Video video="assets/demo.mp4" />
```

`trim` でソースの切り出しも可能です（フレーム単位）。

```tsx
<Video video="assets/demo.mp4" trim={{ from: 30, duration: 120 }} />
```

タイムラインの波形表示は60秒未満のクリップは自動で有効です。
長いクリップは `showWaveform` を指定した場合のみ表示されます。

```tsx
<Video video="assets/demo.mp4" showWaveform />
```

### `video_length`
動画の長さを取得します。
```tsx
const length = video_length({ path: "assets/demo.mp4" })
```

### `<Sound>`

Studio で音声を再生しつつ、レンダリング後にも該当箇所に音をつけます。

```tsx
import { Sound } from "../src/lib/sound/sound"

<Sound sound="assets/music.mp3" trim={{ trimStart: 30 }} />
```

タイムラインの波形表示は60秒未満のクリップは自動で有効です。
長いクリップは `showWaveform` を指定した場合のみ表示されます。

```tsx
<Sound sound="assets/music.mp3" showWaveform />
```

### `<Character>`

音量に応じて口の閉じた/開いた画像を切り替えます。
`clipLabel` を指定すると、そのラベルのクリップ内の音声にのみ反応します。

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
