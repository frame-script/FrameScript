---
title: FrameScript ドキュメント
sidebar_position: 1
---

FrameScript は React / Electron / Rust を組み合わせた、コードファーストなモーショングラフィックス基盤です。
React コンポーネントとしてシーンを記述し、Studio でプレビューし、ヘッドレス Chromium で確定的に書き出します。

## クイックスタート

1) Studio UI を起動（プロジェクトルートの scripts を参照）。
2) `project/` 内のコンポーネントやシーンを編集。
3) Timeline でスクラブしてタイミングを確認。
4) メニューの **Render...** から書き出し。

## 主要コンセプト

- **Project**: 固定サイズの描画領域を提供するルート。
- **Timeline/Clip**: クリップ範囲を登録し、可視/不可視を制御。
- **Current frame**: すべてのアニメーションは 1 つのフレームカウンタから導出。
- **Render mode**: レンダー時は `window.__frameScript.setFrame` で駆動。

## まず見るべき場所

- `project/project.tsx` が全体の構成とクリップ順序を定義。
- `project/scenes/*` が各シーンの実装。
- `src/lib/*` が Clip/Timeline/Frame/Media の基盤。

## 次に読む

- コンポーネントと API: `components`
- レンダーの仕組み: `rendering`
- Studio の使い方: `studio-usage`
