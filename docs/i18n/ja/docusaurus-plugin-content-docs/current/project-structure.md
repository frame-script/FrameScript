---
title: プロジェクト構成
sidebar_position: 2
---

プロジェクトは Studio 本体と、あなたが書くコンテンツに分かれています。

## 主要ディレクトリ

- `project/`: 作品コード（scenes, theme, components）
- `src/lib/`: Clip/Timeline/Frame/Media などの基盤
- `src/ui/`: Studio UI（timeline, transport, render dialogs）
- `backend/`: Rust 製の decode サーバ
- `render/`: headless Chromium を駆動するレンダラ

## 作品コードの中心

`project/project.tsx` に全体構成を記述します。

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

各シーンは `project/scenes/` に置き、React で自由に構成できます。

## Theme と Global styles

- `project/theme.ts` で色やアクセントを定義。
- `project/styles.tsx` でグローバル CSS を定義。
- `project/components/` に共有 UI を配置。
