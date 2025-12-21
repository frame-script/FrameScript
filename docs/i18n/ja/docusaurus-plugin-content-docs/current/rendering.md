---
title: レンダリングの仕組み
sidebar_position: 5
---

FrameScript はヘッドレス Chromium と Rust のエンコーダで描画します。
Studio と同じ見た目を保ちながら、フレーム単位で確定的に書き出せます。

## 流れ（概要）

1) Render バイナリが headless Chromium を起動。
2) Chromium が `render.html` と `PROJECT` をロード。
3) `window.__frameScript.setFrame(frame)` でフレーム固定。
4) 1 フレームごとにスクリーンショット取得。
5) Rust が ffmpeg にフレームを渡してセグメント化。
6) セグメントを連結し、必要に応じて音声をミックス。

## Frame driver

`WithCurrentFrame` が `window.__frameScript` を公開します。

- `setFrame(frame)`: global frame を更新。
- `getFrame()`: 現在の frame を取得。
- `waitCanvasFrame(frame)`: video canvas の描画完了を待つ。

Render は `setFrame` を待ってからフレームを設定し、必要に応じて
`waitCanvasFrame` を待ってスクショを撮ります。

## Video frames

レンダー時は `<Video>` が `/ws` にフレームを要求します。
バックエンドは ffmpeg でデコードし、キャッシュを管理します。

## Audio plan

`<Video>` と `<Sound>` が Audio Plan を生成します。
レンダー前に Studio が plan を送信し、レンダー完了後に ffmpeg が音声を合成します。

## Render settings

Render 設定で次を指定できます。

- 出力サイズ（width/height）
- FPS と総フレーム数
- ワーカー数（並列 Chromium 数）
- エンコード（H264/H265）と preset
- バックエンドのキャッシュサイズ

これらは render バイナリに引数として渡されます。

## 安定化のコツ

- `backdrop-filter` や重い filter は render 時に無効化（`useIsRender()`）。
- CSS アニメーションは wall-clock ではなく `useCurrentFrame()` で制御。
- video の描画完了が必要なら `waitCanvasFrame` を使う。

詳細は `RENDER_KNOWN_ISSUE` を参照してください。
