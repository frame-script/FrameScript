import { VideoCanvas } from "../src/gpu/video"
import { Clip } from "../src/lib/clip"
import { seconds, useCurrentFrame } from "../src/lib/frame"
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
                <Clip start={seconds(0)} end={seconds(3)} label="Clip1">
                    <Text />
                </Clip>
                <Clip start={seconds(2)} end={seconds(5)} label="Clip2">
                    <Text />
                </Clip>
                <Clip start={seconds(1)} end={seconds(5)} label="Clip3">
                    <Clip start={seconds(2)} end={seconds(10)} label="Clip3->Clip1">
                        <Text />
                        <VideoCanvas video="~/Videos/2025-11-11 14-44-16.mp4" />
                    </Clip>
                </Clip>
            </TimeLine>
        </Project>
    )
}

const Text = () => {
    const currentFrame = useCurrentFrame()

    return (
        <p style={{ color: "white" }}>Frame: {currentFrame}</p>
    )
}
