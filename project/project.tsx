import { Clip } from "../src/lib/clip"
import { seconds, useCurrentFrame } from "../src/lib/frame"
import { Project } from "../src/lib/project"
import { TimeLine } from "../src/lib/timeline"


export const PROJECT = () => {
    return (
        <Project settings={{ name: "test-project", width: 1920, height: 1080, fps: 60 }}>
            <TIMELINE />
        </Project>
    )
}

// DO NOT INLINE IT!
const TIMELINE = () => {
    return (
        <TimeLine>
            <Clip start={seconds(1)} end={seconds(3)}>
                <Text />
            </Clip>
            <Clip start={seconds(2)} end={seconds(5)}>
                <Text />
            </Clip>
        </TimeLine>
    )
}

const Text = () => {
    const currentFrame = useCurrentFrame()

    return (
        <p style={{ color: "white" }}>Frame: {currentFrame}</p>
    )
}
