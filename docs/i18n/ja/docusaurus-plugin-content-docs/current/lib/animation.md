---
title: アニメーション！
sidebar_position: 4
---

FrameScript は大まかな動画の制御を `<TimeLine/>` 上で行いますが、細かなアニメーションの状態を管理するための仕組みもあります。

## 概要とイメージ

```tsx
import { useAnimation, useVariable } from "../src/lib/animation"
import { BEZIER_SMOOTH } from "../src/lib/animation/functions"
import { FillFrame } from "../src/lib/layout/fill-frame"
import { seconds } from "../src/lib/frame"

const CircleScene = () => {
  // 位置と不透明度をアニメーション可能な変数として保持
  const position = useVariable({ x: -300, y: 0 })
  const opacity = useVariable(0)

  const { ready } = useAnimation(async (ctx) => {
    // 同時に動かしたい処理は handle を作って並列で待つ
    const move = ctx.move(position).to({ x: 240, y: 0 }, seconds(1.2), BEZIER_SMOOTH)
    const fade = ctx.move(opacity).to(1, seconds(0.6), BEZIER_SMOOTH)
    await ctx.parallel([move, fade])
  }, [])

  // 事前計算が終わるまで描画しない
  if (!ready) return null

  // 現在フレームに対応した値を取得
  const pos = position.use()

  return (
    <FillFrame style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: "999px",
          background: "#38bdf8",
          opacity: opacity.use(),
          transform: `translate(${pos.x}px, ${pos.y}px)`,
          boxShadow: "0 20px 60px rgba(56,189,248,0.35)",
        }}
      />
    </FillFrame>
  )
}
```

上の例では、`useVariable` で位置と不透明度を作り、`useAnimation` で「移動」と「フェードイン」を同時に走らせています。`variable.use()` を JSX のスタイルに使うだけで、現在フレームの値が自動で反映されます。

![](./circle.gif)

## async/await で順序を入れ替えられる

`useAnimation` は async/await で進行管理できます。await の順番を変えることで、同じモーションでも「いつ待つか」を自由に調整できます。

```tsx
useAnimation(async (ctx) => {
  // まず動きをキック
  const move = ctx.move(position).to({ x: 300, y: 0 }, seconds(1), BEZIER_SMOOTH)

  // 先に別の待ち時間を入れる
  await ctx.sleep(seconds(0.4))

  // move がすでに進んでいればすぐ終わる
  await move
}, [])
```

ポイントは「先に動かしておいて、あとで await する」ことができる点です。これにより、同期的に順番通りに実行するだけでなく、簡単に重ね合わせ（並行演出）も作れます。

## Effects: SpeedLines

`<SpeedLines />` は集中線のオーバーレイで、フレームに合わせて微妙に揺れます。

```tsx
import { SpeedLines } from "../src/lib/animation/effect/speed-lines"
import { FillFrame } from "../src/lib/layout/fill-frame"

const Impact = () => (
  <FillFrame>
    <SpeedLines />
  </FillFrame>
)
```
