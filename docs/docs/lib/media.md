---
title: Video and Audio
sidebar_position: 3
---

### `<Video>`

Places video with audio (you can mute if needed).
Studio uses a `<video>` tag; render mode uses WebSocket + Canvas.

```tsx
import { Video } from "../src/lib/video/video"

<Video video="assets/demo.mp4" />
```

You can trim the source in frames:

```tsx
<Video video="assets/demo.mp4" trim={{ from: 30, duration: 120 }} />
```

Waveform display in the timeline is automatic for clips shorter than 60 seconds.
For longer clips, set `showWaveform` to enable it explicitly:

```tsx
<Video video="assets/demo.mp4" showWaveform />
```

### `<Img>`

Image component that waits for decode before the headless renderer captures frames.

```tsx
import { Img } from "../src/lib/image"

<Img src="assets/intro.png" />
```

### `video_length`

Returns the length of a video in frames.

```tsx
const length = video_length({ path: "assets/demo.mp4" })
```

### `<Sound>`

Plays audio in Studio and applies it to the final render.

```tsx
import { Sound } from "../src/lib/sound/sound"

<Sound sound="assets/music.mp3" trim={{ trimStart: 30 }} />
```

Waveform display in the timeline is automatic for clips shorter than 60 seconds.
For longer clips, set `showWaveform` to enable it explicitly:

```tsx
<Sound sound="assets/music.mp3" showWaveform />
```

### `<Character>`

Switches between closed/open mouth images based on audio loudness.
If `clipLabel` is provided, it only reacts to audio inside clips with that label.

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

Controls animations such as lip-sync using a PSD file.
Within the `<PsdCharacter>` component, dedicated components are used to control PSD options and render them onto a canvas.
You can create custom components, but you cannot use hooks internally.

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

The main components are as follows:

#### `<MotionSequence>`

Serializes child elements.
Internally, it uses `<Sequence>`, and each child is wrapped in a `<Clip>`.

```tsx
import { MotionSequence, createSimpleLipSync } from "../src/lib/character/character-unit"

const SimpleLipSync = createSimpleLipSync({
  kind: "bool",
  options: {
    Default: "表情/口/1",
    Open: "表情/口/1",
    Closed: "表情/口/5",
  }
})

<MotionSequence>
  <SimpleLipSync voice="../assets/001_char.wav" />
  <SimpleLipSync voice="../assets/002_char.wav" />
</MotionSequence>
```


#### `<MotionClip>`

Used directly under `MotionSequence` to run child elements in parallel.

```tsx
import { MotionSequence, MotionClip, createSimpleLipSync } from "../src/lib/character/character-unit"

const SimpleLipSync = createSimpleLipSync({
  kind: "bool",
  options: {
    Default: "表情/口/1",
    Open: "表情/口/1",
    Closed: "表情/口/5",
  }
})

<MotionSequence>
  <SimpleLipSync voice="../assets/001_char.wav" />
  <MotionClip>
    <SimpleLipSync voice="../assets/002_char.wav" />
    <SimpleLipSync voice="../assets/003_char.wav" />
  </MotionClip>
</MotionSequence>
```


#### `<Voice>`

Places an audio clip.
Internally, the audio is wrapped in a `<Clip>`.

```tsx
import { Voice } from "../src/lib/character/character-unit"

<Voice voice="../assets/001_char.wav" />
```


#### `<MotionWithVars>`

Creates animations using variables.
First declare variables with `variables`, then define the animation with `animation`, and finally return PSD options with `motion`.

The options must conform to the `data` argument of `renderPsd` from ag-psd-psdtool.

Since hooks cannot be used under `PsdCharacter`, retrieve `Variable` values using `frames[0]` and the `get` method.

`frames[0]` contains the frame number obtained from `useCurrentFrame`, but note that `MotionWithVars` itself is not wrapped in a `<Clip>`.

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

A function that returns a component for volume-based lip-sync compatible with PSD files.

It takes a dictionary that maps mouth states in the PSD to layers/options and returns a component.

Dictionary format:

* When using psd-tool-kit:

  * Set `kind` to `enum`
  * Specify the mouth layer in `Mouth`
  * Specify the default option in `Default`
  * Specify corresponding options in `Open` / `Closed`

* When not using psd-tool-kit:

  * Set `kind` to `bool`
  * Specify the default layer in `Default`
  * Specify corresponding layers in `Open` / `Closed`

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

A function that returns a component for vowel-based lip-sync compatible with PSD files.

It takes a dictionary mapping mouth states to layers/options and returns a component.
The component receives timing data via `data` to control lip-sync.

`data` is compatible with the output of rhubarb:
[https://github.com/DanielSWolf/rhubarb-lip-sync](https://github.com/DanielSWolf/rhubarb-lip-sync)

Dictionary format is the same as above.

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
  ]
}

<PsdCharacter psd="../assets/char.psd">
  <Voice voice="../assets/001_char.wav" />
  <LipSync data={lipsync} />
</PsdCharacter>
```


#### `createBlink`

A function that returns a component for blinking compatible with PSD files.

It takes a dictionary mapping eye states to layers/options and returns a component.
The component receives timing data via `data` to control blinking.

Mapping for `data.value`:

| value | option       |
| ----- | ------------ |
| "A"   | "Open"       |
| "B"   | "HalfOpen"   |
| "C"   | "HalfClosed" |
| "D"   | "Closed"     |

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
  ]
}

<PsdCharacter psd="../assets/char.psd">
  <Voice voice="../assets/001_char.wav" />
  <Blink data={lipsync} />
</PsdCharacter>
```


### `<DialogueScenario>`

Creates a dialogue-style scenario using PSD-based character images.

Main child components:


#### `<DeclareCharacters>`

Declares characters to be used, with `<DeclareCharacter>` as children.


#### `<DeclareCharacter>`

Declares a character inside `<DeclareCharacters>`.
Can accept the same child components as `<PsdCharacter>`, which will be used as behavior when the character is not speaking.


#### `<Scenario>`

Defines a conversation by arranging `<Chapter>` components.


#### `<Chapter>`

Defines a unit of dialogue inside `<Scenario>`.
Use `<Speaker>` to declare the speaker.
Other React components can also be placed.


#### `<Speaker>`

Declares the behavior of the speaking character inside `<Chapter>`.
Accepts the same child components as `<PsdCharacter>`.
Specify the `name` declared in `<DeclareCharacter>` to display the corresponding PSD.

```tsx
const AkaneLipSync = createSimpleLipSync({
  kind: "enum",
  options: {
    Mouth: "目・口/口",
    Default: "開き",
    Open: "開き",
    Closed: "閉じ",
  }
})

const AoiLipSync = createSimpleLipSync({
  kind: "bool",
  options: {
    Default: "全身/顔パーツ/口/お",
    Open: "全身/顔パーツ/口/あ",
    Closed: "全身/顔パーツ/口/にま",
  }
})

<DialogueSenario>
  <DeclareCharacters>
    <DeclareCharacter idleClassName="akane" speakingClassName="akane" name="akane" psd="../assets/akane.psd" />
    <DeclareCharacter idleClassName="aoi" speakingClassName="aoi" name="aoi" psd="../assets/aoi.psd" />
  </DeclareCharacters>
  <Scenario>
    <Chapter>
      <Speaker name="aoi">
        <AoiLipSync voice="../assets/001_aoi.wav"/>
      </Speaker>
    </Chapter>
    <Chapter>
      <Speaker name="akane">
        <AkaneLipSync voice="../assets/002_akane.wav" />
      </Speaker>
    </Chapter>
  </Scenario>
</DialogueSenario>
```

