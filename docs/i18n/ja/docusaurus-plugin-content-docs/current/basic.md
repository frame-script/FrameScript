---
title: 基本
sidebar_position: 2
---

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
          {/* <Video/> は動画を読み込む */}
          <Video video={{ path: "~/Videos/example.mp4" }} />
        </Clip>
      </TimeLine>
    </Project>
  )
}
```
