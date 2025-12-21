---
title: Studio の使い方
sidebar_position: 3
---

FrameScript Studio はプレビューとスクラブを行うための UI です。

## レイアウト

- **Clip list**: クリップの可視/不可視を切り替え。
- **Preview**: 固定アスペクトのプレビュー領域。
- **Timeline**: クリップ範囲、プレイヘッド、再生コントロール。

## 再生とスクラブ

- Transport で再生/停止。
- Timeline 上でプレイヘッドをドラッグ。
- プレイヘッドが global frame を更新します。

## Clip visibility

Clip パネルで表示を切り替えられます。親 Clip を非表示にすると、子 Clip も非表示になります。

## Render dialog

メニューの **Render...** から設定ウィンドウを開きます。Timeline の長さから
総フレーム数を算出し、Audio Plan を送信した後に render を起動します。

## Tips

- シャープさ確認は 100% 表示で。
- 調整中は短いクリップで検証し、仕上げで伸ばす。
- プレビューは良いのにレンダーで崩れる場合は `useIsRender()` で表現を切り替える。
