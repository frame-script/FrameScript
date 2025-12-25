---
title: FrameScript ドキュメント
sidebar_position: 1
---

FrameScript は React / CSS で描画する、コードファーストな モーショングラフィックス & 動画編集 基盤です。
React コンポーネントとしてシーンを記述し、Studio でプレビューし、ヘッドレス Chromium で書き出します。

## クイックスタート

### 依存関係

:::tip
FrameScript を動かすには [`Node.js`](https://nodejs.org/ja) が必要です。

macOS の場合は [`brew`](https://brew.sh/) を使ってインストールすることを推奨します。
:::

### プロジェクトの作成

任意のディレクトリで以下のコマンドを実行します。

```bash
npm init @frame-script/latest
```

このコマンドを実行すると対話形式でプロジェクトを作成できます。

作成されたディレクトリに移動して、

```bash
cd <project-path>
```

以下を実行します。

```bash
npm run start
```

FrameScript Studio が立ち上がります。

### プロジェクトを編集

プロジェクトは `project/project.tsx` に記述されています。
