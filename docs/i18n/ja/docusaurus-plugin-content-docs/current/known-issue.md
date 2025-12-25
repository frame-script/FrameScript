---
title: レンダーの既知問題
sidebar_position: 6
---

# レンダーの既知問題

## 前提

- レンダーは headless Chromium（`chromiumoxide`）で実行されます。

## 既知の問題と回避策

### 1) `backdrop-filter`（ガラス表現）で欠け・ちらつきが出る

**症状**

- ある特定フレーム付近で、パネルの一部が「欠ける」「チラつく」「一瞬だけ未描画になる」。
- 何度レンダーしても、だいたい同じフレームで発生することがある。

**原因（推定）**

- `backdrop-filter` は背面をサンプリングしてぼかすため、合成パスが複雑になります。
- headless Chromium では、`backdrop-filter` + `transform` の組み合わせで合成が不安定になり、中間状態が写ることがあります。

**回避策**

- レンダー時だけ `backdrop-filter` を無効化する（最も確実）。
  - 本リポジトリでは `GlassPanel` がレンダー時に `backdrop-filter` を `none` に切り替えています。
- 再現性を優先する場合、次の表現も避けるのが安全です:
  - `filter: blur(...)` / `drop-shadow(...)` の多用
  - 大きな要素への `transform` とフィルタの同時使用
