import { Clip, ClipSequence } from "../src/lib/clip"
import { seconds } from "../src/lib/frame"
import { FillFrame } from "../src/lib/layout/fill-frame"
import { Project, type ProjectSettings } from "../src/lib/project"
import { TimeLine } from "../src/lib/timeline"
import { THEME } from "./theme"
import { GlobalStyles } from "./styles"
import { IntroScene } from "./scenes/intro"
import { FeaturesScene } from "./scenes/features"
import { TimelineScene } from "./scenes/timeline"
import { OutroScene } from "./scenes/outro"

export const PROJECT_SETTINGS: ProjectSettings = {
  name: "framescript-mog",
  width: 1920,
  height: 1080,
  fps: 60,
}

const intro = seconds(3.5)
const features = seconds(5.0)
const timeline = seconds(5.0)
const outro = seconds(3.5)

export const PROJECT = () => {
  return (
    <Project>
      <GlobalStyles />
      <TimeLine>
        <FillFrame>
          <div style={{ position: "absolute", inset: 0, background: THEME.bg0 }} />
        </FillFrame>

        <ClipSequence>
          <Clip duration={intro} label="Intro">
            <IntroScene durationFrames={Math.round(intro)} />
          </Clip>
          <Clip duration={features} label="Features">
            <FeaturesScene durationFrames={Math.round(features)} />
          </Clip>
          <Clip duration={timeline} label="Timeline">
            <TimelineScene durationFrames={Math.round(timeline)} />
          </Clip>
          <Clip duration={outro} label="Outro">
            <OutroScene durationFrames={Math.round(outro)} />
          </Clip>
        </ClipSequence>
      </TimeLine>
    </Project>
  )
}
