import { useAnimation, useVariable } from "../src/lib/animation"
import { DrawText } from "../src/lib/animation/effect/draw-text"
import { BEZIER_SMOOTH } from "../src/lib/animation/functions"
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
  const progress = useVariable(0)

  useAnimation(async (context) => {
    await context.move(progress).to(1, seconds(3), BEZIER_SMOOTH)
    await context.sleep(seconds(1))
    await context.move(progress).to(0, seconds(3), BEZIER_SMOOTH)
  }, [])

  return (
    <FillFrame style={{ alignItems: "center", justifyContent: "center" }}>
      <DrawText
        text="Hello, world!"
        fontUrl="assets/NotoSerifCJKJP-Medium.ttf"
        strokeWidth={2}
        progress={progress}
      />
    </FillFrame>
  )
}

export const PROJECT = () => {
  return (
    <Project>
      <TimeLine>
        <Clip label="Hello">
          <HelloScene />
        </Clip>
      </TimeLine>
    </Project>
  )
}
