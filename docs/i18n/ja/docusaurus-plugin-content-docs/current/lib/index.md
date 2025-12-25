---
title: ライブラリ
sidebar_position: 1
---

## 組み込みライブラリ

FrameScript には動画を構成・編集するためのライブラリが用意されています。
主なライブラリは `src/lib` にあり、必要なものを import して使います。
この章ではよく使うものを紹介します。

## 基本構成

プロジェクトは `project/project.tsx` にあります。
ここに記述することで動画を構築・編集します。

`project.tsx`の最小構成の例は以下のとおりです。

```tsx
import { Clip } from "../src/lib/clip"
import { Project, type ProjectSettings } from "../src/lib/project"
import { TimeLine } from "../src/lib/timeline"
import { Video } from "../src/lib/video/video"

// プロジェクトの設定
export const PROJECT_SETTINGS: ProjectSettings = {
  name: "framescript-minimal",
  width: 1920,
  height: 1080,
  fps: 60,
}

// プロジェクトの定義
// ここに要素を付け足していくことで動画を構築する
export const PROJECT = () => {
  return (
    <Project>
      <TimeLine>
        {/* <Clip> はタイムラインに表示される要素 */}
        {/* タイムライン上の長さは <Video/> の長さを自動で反映する（指定も可能） */}
        <Clip label="Clip Name">
          { /* <Video/> は動画を読み込む */ }
          <Video video={{ path: "~/Videos/example.mp4" }}/>
        </Clip>
      </TimeLine>
    </Project>
  )
}
```
