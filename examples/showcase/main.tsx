// FrameScript2, shown by itself: 40 seconds at 1080p60 in six scenes, cut to music made by
// music.py. Run ./make-assets.sh first: it makes assets/music.wav and fetches assets/Fox.glb.
import { Audio, Clip, Sequence, Timeline, useGlobalCurrentFrame } from "framescript"
import { AT } from "./beat.ts"
import { CityScene } from "./scenes/city.tsx"
import { CodeScene } from "./scenes/code.tsx"
import { Intro } from "./scenes/intro.tsx"
import { OutroScene } from "./scenes/outro.tsx"
import { RunScene } from "./scenes/run.tsx"
import { StudioScene } from "./scenes/studio.tsx"

export default function Main() {
  return (
    <Timeline>
      <Audio src="assets/music.wav" />
      <Sequence>
        <Clip label="intro" duration={AT.city - AT.intro}>
          <Intro />
        </Clip>
        <Clip label="city" duration={AT.studio - AT.city}>
          <CityScene />
        </Clip>
        <Clip label="studio" duration={AT.run - AT.studio}>
          <StudioScene />
        </Clip>
        <Clip label="run" duration={AT.code - AT.run}>
          <RunScene />
        </Clip>
        <Clip label="code" duration={AT.outro - AT.code}>
          <CodeScene />
        </Clip>
        <Clip label="outro" duration={AT.end - AT.outro}>
          <OutroScene />
        </Clip>
      </Sequence>
      <Clip label="cuts">
        <Cuts />
      </Clip>
    </Timeline>
  )
}

/** A flash of white at each cut, out of black at the start, and into it at the end. */
function Cuts() {
  const frame = useGlobalCurrentFrame()
  const cuts = [AT.city, AT.studio, AT.run, AT.code, AT.outro]
  const flash = () => {
    const f = frame()
    const since = Math.min(...cuts.map((c) => (f >= c ? f - c : Infinity)))
    return Number.isFinite(since) ? 0.9 * Math.exp(-since / 7) : 0
  }
  const dark = () => {
    const f = frame()
    return Math.max(0, 1 - f / 30, (f - (AT.end - 75)) / 70)
  }
  return (
    <>
      <div style={{ position: "absolute", inset: 0, background: "#ffffff", opacity: flash }} />
      <div style={{ position: "absolute", inset: 0, background: "#000000", opacity: () => Math.min(1, dark()) }} />
    </>
  )
}
