---
title: 動画とサウンド
sidebar_position: 3
---

### `<Video>`

動画を音声とともに配置します（ミュート可能）。
Studio では `<video>`、レンダー時は WebSocket + Canvas で再生します。

```tsx
import { Video } from "../src/lib/video/video"

<Video video="assets/demo.mp4" />
```

`trim` でソースの切り出しも可能です（フレーム単位）。

```tsx
<Video video="assets/demo.mp4" trim={{ from: 30, duration: 120 }} />
```

タイムラインの波形表示は60秒未満のクリップは自動で有効です。
長いクリップは `showWaveform` を指定した場合のみ表示されます。

```tsx
<Video video="assets/demo.mp4" showWaveform />
```

### `<Img>`

レンダラーがフレームを取得する前にデコード完了を待つ画像コンポーネントです。

```tsx
import { Img } from "../src/lib/image"

<Img src="assets/intro.png" />
```

### `video_length`
動画の長さを取得します。
```tsx
const length = video_length({ path: "assets/demo.mp4" })
```

### `<Sound>`

Studio で音声を再生しつつ、レンダリング後にも該当箇所に音をつけます。

```tsx
import { Sound } from "../src/lib/sound/sound"

<Sound sound="assets/music.mp3" trim={{ trimStart: 30 }} />
```

タイムラインの波形表示は60秒未満のクリップは自動で有効です。
長いクリップは `showWaveform` を指定した場合のみ表示されます。

```tsx
<Sound sound="assets/music.mp3" showWaveform />
```

### `<Character>`

音量に応じて口の閉じた/開いた画像を切り替えます。
`clipLabel` を指定すると、そのラベルのクリップ内の音声にのみ反応します。

```tsx
import { Character } from "../src/lib/sound/character"

<Clip label="Voice">
  <Sound sound="assets/voice.mp3" />
</Clip>

<Character
  mouthClosed="assets/char_closed.png"
  mouthOpen="assets/char_open.png"
  threshold={0.12}
  clipLabel="Voice"
/>
```

### `<PsdCharacter>`

PSD形式の立ち絵を利用した口パクなどのアニメーションを宣言します。
`<PsdCharacter>`コンポーネント内で、専用のコンポーネントを利用してPSDのオプションを制御し、canvasへ描画します。
コンポーネントを作成することもできますが、内部でフックを使うことは出来ません。

```tsx
import { BEZIER_SMOOTH } from "../src/lib/animation/functions"
import { seconds } from "../src/lib/frame"
import { PsdCharacter, MotionSequence, MotionWithVars, createSimpleLipSync } from "../src/lib/character/character-unit"


const SimpleLipSync = createSimpleLipSync({
  kind: "bool",
  options: {
    Default: "表情/口/1",
    Open: "表情/口/1",
    Closed: "表情/口/5",
  }
})

<PsdCharacter psd="../assets/char.psd" className="char">
  <MotionSequence>
    <SimpleLipSync voice="../assets/001_char.wav" />
    <MotionWithVars
      variables={{t: 0 as number}}
      animation={async (ctx, variables) => {
        await ctx.move(variables.t).to(1, seconds(1), BEZIER_SMOOTH)

      }}
      motion={(variables, frames) => {
        const t = variables.time.get(frames[0])
        if (t > 0.5) {
          return {
            "表情/目/9": false,
            "表情/目/17": true
          }
        } else {
            return {}
        }
      }}
    />

  </MotionSequence>
</PsdCharacter>
```

主なコンポーネントは次の通りです。

#### `<MotionSequence>`

子要素を直列化します。
内部的には`<Sequence>`を利用しており、子要素は`<Clip>`で囲われます。

```tsx
import { MotionSequence, Voice } from "../src/lib/character/character-unit"

<MotionSequence>
  <Voice voice="../assets/001_char.wav" />
  <Voice voice="../assets/002_char.wav" />
</MotionSequence>
```

#### `<MotionClip>`

MotionSequence直下で使用して、子要素を並列化します。

```tsx
import { MotionSequence, MotionClip, Voice } from "../src/lib/character/character-unit"

<MotionSequence>
  <Voice voice="../assets/001_char.wav" />
  <MotionClip>
    <Voice voice="../assets/002_char.wav" />
    <Voice voice="../assets/003_char.wav" />
  </MotionClip>
</MotionSequence>
```

#### `<Voice>`

音声を配置します。
内部的には音声はClipで囲われます。

```tsx
import { Voice } from "../src/lib/character/character-unit"

<Voice voice="../assets/001_char.wav" />
```

#### `<MotionWithVars>`

変数を使用したアニメーションを作成します。
`variables`で変数を宣言し、次に`animation`でアニメーションを宣言し、最後に`motion`でPSDのオプションを返します。
オプションはag-psd-psdtoolの`renderPsd`の引数`data`に準拠します。

`PsdCharacter`以下ではフックが使えないため、`Variable`の値は`frames[0]`を利用して、`get`メソッドから得てください。

`frames[0]`には`useCurrentFrame`で得られるフレーム数が入っていますが、`MotionWithVars`自体は`<Clip>`で囲われないことに注意してください。

```tsx
import { BEZIER_SMOOTH } from "../src/lib/animation/functions"
import { seconds } from "../src/lib/frame"
import { MotionWithVars } from "../src/lib/character/character-unit"

<MotionWithVars
  variables={{t: 0 as number}}
  animation={async (ctx, variables) => {
    await ctx.move(variables.t).to(1, seconds(1), BEZIER_SMOOTH)

  }}
  motion={(variables, frames) => {
    const t = variables.time.get(frames[0])
    if (t > 0.5) {
      return {
        "表情/目/9": false,
        "表情/目/17": true
      }
    } else {
        return {}
    }
  }}
/>
```

#### `createSimpleLipSync`

PSDファイルに対応した音量ベースの口パクを行うコンポーネントを返す関数です。
PSDの口の状態をレイヤー、オプションに対応させる辞書を受け取り、コンポーネントを返します。
辞書は次のように指定します。

- psd-tool-kitに対応している場合

  `kind`には`enum`を指定します。

  `Mouth`にはPSDの口のレイヤーを指定します。

  `Default`にはPSDファイルがデフォルトで表示する口のオプションを指定します。

  `Open` / `Closed`にはそれぞれ対応するオプションを指定します。

- psd-tool-kitに対応していない場合

  `kind`には`bool`を指定します。

  `Default`にはPSDファイルがデフォルトで表示する口のレイヤーを指定します。

  `Open` / `Closed`にはそれぞれ対応するレイヤーを指定します。

```tsx
import { createSimpleLipSync } from "../src/lib/character/character-unit"

const SimpleLipSync = createSimpleLipSync({
  kind: "bool",
  options: {
    Default: "表情/口/1",
    Open: "表情/口/1",
    Closed: "表情/口/5",
  }
})

<SimpleLipSync voice="../assets/001_char.wav" />
```

#### `createLipSync`

PSDファイルに対応した母音ベースの口パクを行うコンポーネントを返す関数です。

PSDの口の状態をレイヤー、オプションに対応させる辞書を受け取り、コンポーネントを返します。
コンポーネントは`data`としてタイミング情報を受け取り、口パクを制御します。
`data`はrhubarb( https://github.com/DanielSWolf/rhubarb-lip-sync )の出力に対応します。
辞書は次のように指定します。

- psd-tool-kitに対応している場合

  `kind`には`enum`を指定します。

  `Mouth`にはPSDの口のレイヤーを指定します。

  `Default`にはPSDファイルがデフォルトで表示する口のオプションを指定します。

  `Open` / `Closed`にはそれぞれ対応するオプションを指定します。

- psd-tool-kitに対応していない場合

  `kind`には`bool`を指定します。

  `Default`にはPSDファイルがデフォルトで表示する口のレイヤーを指定します。

  `Open` / `Closed`にはそれぞれ対応するレイヤーを指定します。


```tsx
import { createLipSync } from "../src/lib/character/character-unit"

const LipSync = createLipSync({
  kind: "enum",
  options: {
    Mouth: "表情/口",
    Default: "1",
    A: "1",
    I: "2",
    U: "3",
    E: "4",
    O: "5",
    X: "6",
  }
})

const lipsync = {
  mouthCues: [
    { start: 0.00, end: 0.03, value: "A" },
    { start: 0.03, end: 0.09, value: "B" },
    { start: 0.09, end: 0.29, value: "C" }
}

<PsdCharacter psd="../assets/char.psd">
  <Voice voice="../assets/001_char.wav" />
  <LipSync data={lipsync} />
</PsdCharacter>
```

#### `createBlink`

PSDファイルに対応した目パチを行うコンポーネントを返す関数です。

PSDの目の状態をレイヤー、オプションに対応させる辞書を受け取り、コンポーネントを返します。
コンポーネントは`data`としてタイミング情報を受け取り、目パチを制御します。
辞書は次のように指定します。

- psd-tool-kitに対応している場合

  `kind`には`enum`を指定します。

  `Mouth`にはPSDの口のレイヤーを指定します。

  `Default`にはPSDファイルがデフォルトで表示する口のオプションを指定します。

  `Open` / `Closed`にはそれぞれ対応するオプションを指定します。

- psd-tool-kitに対応していない場合

  `kind`には`bool`を指定します。

  `Default`にはPSDファイルがデフォルトで表示する口のレイヤーを指定します。

  `Open` / `Closed`にはそれぞれ対応するレイヤーを指定します。

`data`のvalueは次のように対応します。
| value | option |
| ---- | ---- |
| "A" | "Open" |
| "B" | "HalfOpen" |
| "C" | "HalfClosed" |
| "D" | "Closed" |



```tsx
import { createBlink, generateBlinkData } from "../src/lib/character/character-unit"

const Blink = createBlink({
  kind: "enum",
  options: {
    Mouth: "表情/目",
    Default: "1",
    Open: "1",
    HalfOpen: "2",
    HalfClosed: "3",
    Closed: "4",
  }
})

// const blink = generateBlinkData(0, 10)
const blink = {
  blinkCues: [
    { start: 0.00, end: 0.01, value: "A" },
    { start: 0.01, end: 0.02, value: "B" },
    { start: 0.02, end: 0.03, value: "C" },
    { start: 0.03, end: 0.04, value: "D" },
    { start: 0.04, end: 0.05, value: "C" },
    { start: 0.05, end: 0.06, value: "B" },
    { start: 0.06, end: 0.07, value: "A" }
}

<PsdCharacter psd="../assets/char.psd">
  <Voice voice="../assets/001_char.wav" />
  <Blink data={blink} />
</PsdCharacter>
```

### `<DialogueScenerio>`

会話形式のシナリオにおいてPSD形式の立ち絵を利用して口パクなどのアニメーションを制御します。

子要素として使用できる主なコンポーネントは次の通りです。

#### `<DeclareCharacters>`
`<DeclareCharacter>`を子要素にとり、利用するキャラクターを宣言します。

#### `<DeclareCharacter>`
`<DeclareCharacters>`内で使用して利用するキャラクターを宣言します。
子要素として`<PsdCharacter>`の子要素と同様のコンポーネントを取ることができ、非話者時の動作として割り当てられます。

#### `<Scenario>`
`<Chapter>`を並べて会話を宣言します。

#### `<Chapter>`
`<Scenario>`内で使用してキャラクターの話す単位を宣言します。
`<Speaker>`を使用して話者を宣言します。
その他Reactコンポーネントを配置することもできます。

#### `<Speaker>`
`<Chapter>`内で使用して、話者の動作を宣言します。
`<PsdCharacter>`の子要素と同様のコンポーネントを取ります。
`<DeclareCharacter>`で宣言した`name`を指定して、対応するPSDを表示します。


```tsx
import { DialogueScenario, DeclareCharacters, DeclareCharacter, Scenario, Chapter, Speaker } from "../src/lib/character/character-manager"
import { Voice } from "../src/lib/character/character-unit"

<DialogueSenario>
  <DeclareCharacters>
    <DeclareCharacter idleClassName="akane" speakingClassName="akane" name="akane" psd="../assets/akane.psd" />
    <DeclareCharacter idleClassName="aoi" speakingClassName="aoi" name="aoi" psd="../assets/aoi.psd" />
  </DeclareCharacters>
  <Scenario>
    <Chapter>
      <Speaker name="aoi">
        <Voice voice="../assets/001_aoi.wav"/>
      </Speaker>
    </Chapter>
    <Chapter>
      <Speaker name="akane">
        <Voice voice="../assets/002_akane.wav" />
      </Speaker>
    </Chapter>
  </Scenario>
</DialogueSenario>
```

