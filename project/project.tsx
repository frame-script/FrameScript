import { DrawText } from "../src/lib/animation/misc/draw-text"
import { Clip } from "../src/lib/clip"
import { seconds } from "../src/lib/frame"
import { FillFrame } from "../src/lib/layout/fill-frame"
import { Project, type ProjectSettings } from "../src/lib/project"
import { TimeLine } from "../src/lib/timeline"

export const PROJECT_SETTINGS: ProjectSettings = {
  name: "framescript-template",
  width: 1920,
  height: 1080,
  fps: 60,
}

const HelloScene = () => {
  return (
    <FillFrame style={{ alignItems: "center", justifyContent: "center" }}>
      <DrawText
        text="Hello, world!"
        fontUrl="./NotoSerifCJKJP-Medium.ttf"
        durationFrames={seconds(2)}
      />
    </FillFrame>
  )
}

export const PROJECT = () => {
  return (
    <Project>
      <TimeLine>
        <Clip label="Hello" duration={seconds(5)}>
          <HelloScene />
        </Clip>
      </TimeLine>
    </Project>
  )
}
