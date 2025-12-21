---
title: Render Known Issues
sidebar_position: 6
---

# Render known issues (描画関連)

## English (Summary)

FrameScript rendering uses headless Chromium to open `render.html`, set a fixed `currentFrame`, and capture screenshots per frame (then encode to video). Because the output depends on the browser compositor, you may see visual glitches in render output even if preview looks fine.

### Prerequisites

- Render pipeline runs on headless Chromium via `chromiumoxide` (`render/src/main.rs`).
- Frames are driven by `window.__frameScript.setFrame(frame)` (`src/lib/frame.tsx`).
- Some sources can expose a “frame-ready” handshake via `waitCanvasFrame(frame)` (`src/lib/video/video-render.tsx`).

### Known issues & mitigations

1) **Flicker/tearing with `backdrop-filter` (glass UI)**
- Symptom: parts of a panel intermittently disappear/flicker for a few frames, often reproducible at the same frame numbers.
- Cause (likely): unstable compositor tiling when `backdrop-filter` is combined with transforms in headless Chromium; intermediate states get captured.
- Mitigation: disable `backdrop-filter` only during render (most reliable). This repo does it in `project/components/panels.tsx`.

2) **3D/WebGL can be non-deterministic**
- Symptom: output differs across machines; occasional single-frame corruption; AA/shadows/noise can vary.
- Cause: GPU/driver/headless rendering path differences.
- Mitigation: design “render-safe” fallbacks, and add a reliable “frame-ready” handshake (extend `waitCanvasFrame` for 3D if needed).

3) **CSS animations not respecting `currentFrame`**
- Symptom: animations run on wall-clock time instead of scrub/render time.
- Mitigation: pause animations and set `animation.currentTime` based on `currentFrame` under each `Clip` (implemented in `src/lib/clip.tsx`).

4) **Assets not fully loaded for early frames**
- Symptom: fonts/images/videos appear blank or incorrect for a few frames.
- Mitigation: wait for readiness (use a handshake such as `waitCanvasFrame`, or add explicit “assets loaded” waiting).

### Debug tips

- If flicker happens at consistent frames, suspect compositor-sensitive CSS (`backdrop-filter`, heavy `filter`, large transformed layers). Temporarily remove/disable and re-render to confirm.

FrameScript のレンダーは `render/` バイナリが headless Chromium を起動し、`render.html` を開いてフレームごとにスクリーンショットを取得→動画化する方式です。
この方式は「ブラウザの描画・合成（compositor）」の挙動に影響を受けるため、プレビューでは問題なく見えても、レンダー出力で差分やグリッチが出る場合があります。

## 前提

- レンダーは headless Chromium（`chromiumoxide`）で実行されます（`render/src/main.rs`）。
- フレーム固定は `window.__frameScript.setFrame(frame)` で行います（`src/lib/frame.tsx`）。
- 映像素材の一部は `waitCanvasFrame(frame)` を通じて「指定フレームの描画完了」を待てます（`src/lib/video/video-render.tsx`）。

## 既知の問題と回避策

### 1) `backdrop-filter`（ガラス表現）で欠け・ちらつきが出る

**症状**

- ある特定フレーム付近で、パネルの一部が「欠ける」「チラつく」「一瞬だけ未描画になる」。
- 何度レンダーしても、だいたい同じフレームで発生することがある。

**原因（推定）**

- `backdrop-filter` は背面をサンプリングしてぼかすため、合成パスが複雑になります。
- headless Chromium では、`backdrop-filter` + `transform`（scale/translate）などの組み合わせで、タイル単位の合成が不安定になり、中間状態がスクリーンショットに写ることがあります。

**回避策**

- レンダー時だけ `backdrop-filter` を無効化する（最も確実）。
  - 本リポジトリでは `GlassPanel` がレンダー時に `backdrop-filter` を `none` に切り替えています（`project/components/panels.tsx`）。
- レンダーでの再現性を優先する場合、次の表現も避けるのが安全です:
  - `filter: blur(...)` / `drop-shadow(...)` の多用
  - 大きな要素への `transform` とフィルタの同時使用

### 2) 3D/WebGL を使うと環境差やちらつきが出る可能性が高い

**症状**

- 環境（GPU/ドライバ/headlessの描画パス）によって見た目が微妙に変わる。
- 特定フレームだけ欠ける/破綻する、アンチエイリアスやシャドウが揺らぐ。

**原因（推定）**

- WebGL は GPU と合成処理に強く依存し、headless Chromium では描画パスが異なることがあります。

**回避策（方針）**

- レンダー専用に「安定する表現（合成しやすい表現）」へ落とす設計を用意する。
- 可能なら「描画完了」を確実に待つ仕組みを用意する（例: `waitCanvasFrame` の 3D 対応強化など）。

### 3) CSS アニメーションが currentFrame に追従しない / 不安定になる

**症状**

- スクラブ/レンダー時に CSS アニメーションが「実時間で動く」「止まらない」「フレームと同期しない」。

**原因**

- CSS アニメーションは通常、壁時計（real time）で進みます。

**対策**

- `Clip` 配下の CSS アニメーションは `pause()` して `currentTime` を `currentFrame` ベースで上書きし、スクラブ/レンダーでも決定的になるようにしています（`src/lib/clip.tsx`）。

**注意**

- `infinite` などのアニメーションは「見た目の意図」と「フレーム固定」のどちらを優先するかで設計方針が変わります。
- 表現によっては「レンダー専用の見た目」を用意するほうが安全です（例: `useIsRender()` で分岐）。

### 4) 素材読み込みが間に合わず、数フレームだけ空になる

**症状**

- 動画/画像/フォントなどが読み込み途中のフレームがキャプチャされ、数フレームだけ表示が崩れる。

**原因**

- フレーム固定しても、リソースの読み込みは非同期で進むため、読み込み完了前にスクショが撮られることがあります。

**回避策**

- 可能ならフレームごとの「描画完了待ち」を行う（`waitCanvasFrame` など）。
- 追加したリソース（フォント等）がある場合、レンダー側で「読み込み完了を待つ」仕組みを検討する。

## Debug / 切り分けのコツ

- 再現フレームが固定なら:
  - そのフレーム周辺で `transform`/filter/backdrop-filter の組み合わせを疑う。
  - 該当要素の `backdrop-filter` を一時的に外して再レンダーし、現象が消えるか確認する。
- プレビューでは再現しない場合:
  - headless Chromium 特有の合成/フォント/タイミング差を疑う（「レンダー時のみ」分岐が有効なことが多い）。
