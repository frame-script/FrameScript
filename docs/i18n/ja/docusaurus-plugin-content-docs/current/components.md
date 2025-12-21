---
title: コンポーネントと API
sidebar_position: 4
---

FrameScript で使う主要プリミティブをまとめます。

## Project と Timeline

### `<Project>`

描画のルート。固定サイズのレンダー面を提供します。

```tsx
import { Project } from "../src/lib/project"

export const PROJECT = () => (
  <Project>
    {/* scenes/clips */}
  </Project>
)
```

### `<TimeLine>`

クリップの登録を管理し、Timeline UI に範囲を表示します。

```tsx
import { TimeLine } from "../src/lib/timeline"

<TimeLine>
  {/* Clip / ClipSequence */}
</TimeLine>
```

## Clips

### `<Clip>`

子要素の報告や `duration` から長さを決定するクリップ。非アクティブ時は描画されません。

```tsx
<Clip label="Intro" duration={seconds(3.5)}>
  <IntroScene durationFrames={seconds(3.5)} />
</Clip>
```

### `<ClipSequence>`

複数の `<Clip>` を 1 レーンで連結します。前のクリップの長さに合わせて start が自動調整されます。

```tsx
<ClipSequence>
  <Clip label="Intro" duration={introFrames}>
    <IntroScene durationFrames={introFrames} />
  </Clip>
  <Clip label="Features" duration={featureFrames}>
    <FeaturesScene durationFrames={featureFrames} />
  </Clip>
</ClipSequence>
```

### `<ClipStatic>`

start/end を明示できる静的クリップ。境界を厳密に制御したい場合に使います。

```tsx
<ClipStatic start={0} end={119} label="Custom Range">
  <MyScene />
</ClipStatic>
```

### `<Serial>`

`<ClipStatic>` を長さを保ったまま直列配置するユーティリティ。

```tsx
<Serial>
  <ClipStatic start={0} end={89} label="A">
    <SceneA />
  </ClipStatic>
  <ClipStatic start={0} end={59} label="B">
    <SceneB />
  </ClipStatic>
</Serial>
```

## Frame utilities

### `WithCurrentFrame` と hooks

`WithCurrentFrame` は global frame を提供します。

- `useCurrentFrame()` は clip 相対のフレーム。
- `useGlobalCurrentFrame()` は project 全体のフレーム。
- `useSetGlobalCurrentFrame()` はスクラブや再生制御に使います。

```tsx
import { WithCurrentFrame, useCurrentFrame } from "../src/lib/frame"

const Scene = () => {
  const f = useCurrentFrame()
  return <div style={{ opacity: f / 60 }}>Hello</div>
}

<WithCurrentFrame>
  <Scene />
</WithCurrentFrame>
```

### `seconds()`

秒数をフレーム数に変換します。

```ts
const introFrames = seconds(3.5)
```

## Layout

### `<FillFrame>`

フレーム全体を覆う絶対配置のコンテナ。

```tsx
<FillFrame>
  <Background />
  <Foreground />
</FillFrame>
```

## Media

### `<Video>`

Studio では `<video>`、レンダー時は WebSocket + Canvas で再生します。

```tsx
import { Video } from "../src/lib/video/video"

<Video video="assets/demo.mp4" />
```

`trim` でソースの切り出しも可能です。

```tsx
<Video video="assets/demo.mp4" trim={{ from: 30, duration: 120 }} />
```

### `<Sound>`

Studio で音声を再生し、レンダー用の Audio Plan を生成します。

```tsx
import { Sound } from "../src/lib/sound/sound"

<Sound sound="assets/music.mp3" trim={{ trimStart: 30 }} />
```

## Render-aware behavior

### `useIsRender()`

ヘッドレス Chromium では不安定な表現を切り替えたい時に使います。

```tsx
const isRender = useIsRender()
return <div style={{ backdropFilter: isRender ? "none" : "blur(10px)" }} />
```
