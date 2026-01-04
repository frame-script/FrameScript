---
title: 基本コンポーネント
sidebar_position: 2
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

export const PROJECT = () => (
  <Project>
    <TimeLine>
      {/* Clip / ClipSequence */}
    </TimeLine>
  </Project>
)
```

## Clips

### `<Clip>`

子要素の報告や `duration` から長さを決定するクリップ。非アクティブ時は描画されません。
また`duration`を指定しない場合は子要素（`<Video/>`や`<Sound/>`）の長さを自動で取得します

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

### Clip utilities

#### `useClipStart()`
現在のクリップの開始フレームを返します。

```tsx
const start = useClipStart()
```

#### `useClipRange()`
現在のクリップの範囲を返します

```tsx
const range = useClipRange()
const start = range.start
const end   = range.end
```

#### `useClipId()`
現在のクリップ ID を返します。

```tsx
const id = useClipId()
```

#### `useClipDepth()`
現在のクリップのネスト深度を返します。
```tsx
const depth = useClipDepth()
```

#### `useClipActive()`
現在のクリップがアクティブかつ表示中なら true を返します。
```tsx
const active = useClipActive()
```

### `<ClipStatic>`

表示する期間を明示できる静的クリップ。境界を厳密に制御したい場合に使います。

```tsx
<ClipStatic start={0} end={119} label="Custom Range">
  <MyScene />
</ClipStatic>
```

### `<Serial>`

`<ClipStatic>` を長さを保ったまま直列配置するユーティリティ。
単純に並べたいときに使います。

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

### `useCurrentFrame()`
現在のフレーム数を取得します。
`<Clip>` 内では相対フレームが返ります。

```ts
// 現在の相対フレーム数を取得
const currentFrame = useCurrentFrame()
// 現在の絶対フレームを取得
const globalCurrentFrame = useGlobalCurrentFrame()
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
