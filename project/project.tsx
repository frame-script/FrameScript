import { VideoCanvas } from "../src/gpu/video"
import { Clip } from "../src/lib/clip"
import { seconds, /*useCurrentFrame*/ } from "../src/lib/frame"
import { Project, type ProjectSettings } from "../src/lib/project"
import { TimeLine } from "../src/lib/timeline"

export const PROJECT_SETTINGS: ProjectSettings = {
    name: "test-project",
    width: 1920,
    height: 1080,
    fps: 60,
}

export const PROJECT = () => {
    return (
        <Project>
            <TimeLine>
                <Clip start={seconds(0)} end={seconds(20)} label="Clip3->Clip1">
                    <VideoCanvas video="~/Videos/1080p.mp4" style={{ width: "100%", height: "100%" }} />
                </Clip>
            </TimeLine>
        </Project>
    )
}

/*
const Text = () => {
    const currentFrame = useCurrentFrame()

    return (
        <p style={{ color: "white" }}>Frame: {currentFrame}</p>
    )
}*/
