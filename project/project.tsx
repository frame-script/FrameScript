import { video_length, VideoCanvas } from "../src/gpu/video"
import { Clip, Serial } from "../src/lib/clip"
import { seconds, useCurrentFrame } from "../src/lib/frame"
import { Project, type ProjectSettings } from "../src/lib/project"
import { TimeLine } from "../src/lib/timeline"

export const PROJECT_SETTINGS: ProjectSettings = {
    name: "test-project",
    width: 1920,
    height: 1080,
    fps: 60,
}

const TEST_VIDEO = { path: "~/Videos/1080p.mp4" }

export const PROJECT = () => {
    return (
        <Project>
            <TimeLine>
                <Clip start={seconds(0)} end={seconds(1)} label="Clip1">
                    <Text />
                </Clip>
                <Serial>
                    <Clip start={seconds(0)} end={video_length(TEST_VIDEO)} label="Clip2">
                        <VideoCanvas video={TEST_VIDEO} style={{ width: "100%", height: "100%" }} />
                    </Clip>
                    <Clip start={video_length(TEST_VIDEO)} end={video_length(TEST_VIDEO) + seconds(10)} label="CLip3">
                        <Text />
                    </Clip>
                </Serial>
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
