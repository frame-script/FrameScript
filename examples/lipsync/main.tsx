// Two characters talking: each mouth follows the lines in the clips with that character's name.
// Run ./make-assets.sh first: it makes the faces, and hums in syllables to stand for the voices.
import { Audio, Clip, FillFrame, LipSync, seconds, Sequence, Timeline } from "framescript"

export default function Main() {
  return (
    <Timeline>
      <FillFrame style={{ flexDirection: "row", gap: 240 }}>
        <Character name="Aoi" />
        <Character name="Kou" />
      </FillFrame>
      {/* A line is a clip with the name of whoever says it; the clips without one are pauses. */}
      <Sequence>
        <Clip duration={seconds(0.5)} />
        <Clip label="Aoi">
          <Audio src="assets/aoi-1.wav" />
        </Clip>
        <Clip duration={seconds(0.4)} />
        <Clip label="Kou">
          <Audio src="assets/kou-1.wav" />
        </Clip>
        <Clip duration={seconds(0.4)} />
        <Clip label="Aoi">
          <Audio src="assets/aoi-2.wav" />
        </Clip>
        <Clip duration={seconds(0.8)} />
      </Sequence>
    </Timeline>
  )
}

/** A face whose mouth moves while the clips with its name are heard. */
function Character(props: { name: string }) {
  const file = `assets/${props.name.toLowerCase()}`
  return (
    <div style={{ alignItems: "center", gap: 32 }}>
      <LipSync
        clip={props.name}
        open={`${file}-open.svg`}
        closed={`${file}-closed.svg`}
        style={{ width: 480, height: 480 }}
      />
      <text style={{ color: "#e2e8f0", fontSize: 56 }}>{props.name}</text>
    </div>
  )
}
