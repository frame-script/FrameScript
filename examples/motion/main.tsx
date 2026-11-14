// A motion graphics reel, made by FrameScript2 alone: 44 seconds at 1080p60 in six scenes, cut to
// music made by music.py. Run ./make-assets.sh first: it makes assets/music.wav.
import { Audio, Clip, For, Sequence, Timeline, useGlobalCurrentFrame } from "framescript"
import { AT } from "./beat.ts"
import { C, inQuint, outQuint, span } from "./design.ts"
import { DataScene } from "./scenes/data.tsx"
import { FinaleScene } from "./scenes/finale.tsx"
import { MorphScene } from "./scenes/morph.tsx"
import { PatternScene } from "./scenes/pattern.tsx"
import { PointScene } from "./scenes/point.tsx"
import { TitleScene } from "./scenes/title.tsx"

export default function Main() {
  return (
    <Timeline>
      <Audio src="assets/music.wav" />
      <Sequence>
        <Clip label="point" duration={AT.title - AT.point}>
          <PointScene />
        </Clip>
        <Clip label="title" duration={AT.morph - AT.title}>
          <TitleScene />
        </Clip>
        <Clip label="morph" duration={AT.data - AT.morph}>
          <MorphScene />
        </Clip>
        <Clip label="data" duration={AT.pattern - AT.data}>
          <DataScene />
        </Clip>
        <Clip label="pattern" duration={AT.finale - AT.pattern}>
          <PatternScene />
        </Clip>
        <Clip label="finale" duration={AT.end - AT.finale}>
          <FinaleScene />
        </Clip>
      </Sequence>
      <Clip label="cuts">
        <Stripes at={AT.morph} />
        <Flash at={AT.finale} />
      </Clip>
    </Timeline>
  )
}

/**
 * Bands of color that sweep over the frame across the cut at `at`: each comes in from the left
 * and goes out to the right, a little after the one above it.
 */
function Stripes(props: { at: number }) {
  const frame = useGlobalCurrentFrame()
  const colors = [C.yellow, C.red, C.blue, C.ink, C.yellow, C.red]
  const height = 1600 / colors.length
  return (
    <div
      style={{
        position: "absolute",
        left: -400,
        top: -260,
        width: 2720,
        height: 1600,
        rotate: -14,
      }}
    >
      <For each={colors}>
        {(color, i) => {
          const start = props.at - 22 + i * 2.5
          const right = () => span(frame(), start, 20, outQuint)
          const left = () => span(frame(), start + 21, 20, inQuint)
          return (
            <div
              style={{
                position: "absolute",
                top: i * height,
                height: height + 1,
                background: color,
                left: () => 2720 * left(),
                width: () => Math.max(0, 2720 * (right() - left())),
              }}
            />
          )
        }}
      </For>
    </div>
  )
}

/** The frame going white at `at`, and back in a moment. */
function Flash(props: { at: number }) {
  const frame = useGlobalCurrentFrame()
  const flash = () => {
    const f = frame()
    if (f < props.at - 4) return 0
    if (f < props.at) return (f - props.at + 4) / 4
    return Math.exp(-(f - props.at) / 9)
  }
  return <div style={{ position: "absolute", inset: 0, background: "#ffffff", opacity: flash }} />
}
