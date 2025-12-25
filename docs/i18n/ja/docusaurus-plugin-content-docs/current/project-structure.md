---
title: プロジェクト構成
sidebar_position: 2
---

プロジェクトは Studio 本体と、あなたが書くコンテンツに分かれています。
基本的には `project/` のみを編集すれば十分です。

## 主要ディレクトリ

- `project/`: 作品コード（scenes, theme, components）
- `src/lib/`: Clip/Timeline/Frame/Media などの基盤
- `src/ui/`: Studio UI（timeline, transport, render dialogs）
- `backend/`: Rust 製の decode サーバ
- `render/`: headless Chromium を駆動するレンダラ

## 作品コードの中心

`project/project.tsx` に全体構成を記述します。ここにシーンやクリップを並べていく形です。

```tsx
<Project>
  <GlobalStyles />
  <TimeLine>
    <ClipSequence>
      <Clip label="Intro" duration={seconds(3.5)}>
        <IntroScene durationFrames={seconds(3.5)} />
      </Clip>
      {/* more clips */}
    </ClipSequence>
  </TimeLine>
</Project>
```
