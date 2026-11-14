// Pictures, videos and sound. Run ./make-assets.sh first: it makes what is in assets/ with ffmpeg.
import {
  Audio,
  BEZIER_SMOOTH,
  Clip,
  FillFrame,
  framesToSeconds,
  seconds,
  Sequence,
  Timeline,
  useAnimation,
  useCurrentFrame,
  useVariable,
  Video,
} from "framescript"

const FULL = { width: "100%", height: "100%" } as const

export default function Main() {
  return (
    <Timeline>
      {/* Under everything, from the start: it comes up, and goes down at the end. */}
      <Audio src="assets/pad.m4a" trimEnd={14} volume={duck} fadeIn={1.5} fadeOut={2} />
      <Sequence>
        <Clip label="photo" duration={seconds(3)}>
          <Photo />
        </Clip>
        <Clip label="counter">
          {/* Six seconds of it, from two seconds in: the clip is as long as that. It beeps as each
              second starts, and the music makes room for it. */}
          <Video src="assets/counter.mp4" trimStart={2} trimEnd={8} style={{ ...FULL, objectFit: "contain" }} />
        </Clip>
        <Clip label="side by side" duration={seconds(5)}>
          <SideBySide />
        </Clip>
      </Sequence>
    </Timeline>
  )
}

/** How loud the music is at a frame: quieter while the counter is on (from 3 s to 9 s). */
function duck(frame: number): number {
  const t = framesToSeconds(frame)
  const ramp = (x: number) => Math.min(Math.max(x / 0.25, 0), 1)
  return 0.6 - 0.45 * ramp(t - 3) * ramp(9 - t)
}

/** A picture that slowly comes closer, and a title over it. */
function Photo() {
  const frame = useCurrentFrame()
  const title = useVariable(0)
  useAnimation(async (ctx) => {
    await ctx.sleep(seconds(0.3))
    await ctx.move(title).to(1, seconds(0.8), BEZIER_SMOOTH)
  })
  return (
    <FillFrame>
      <img
        src="assets/photo.png"
        style={{
          position: "absolute",
          ...FULL,
          objectFit: "cover",
          scale: () => 1 + frame() / 900,
        }}
      />
      <text
        style={{
          // Over the picture, which is positioned: as in CSS, this has to be too.
          position: "relative",
          color: "#f8fafc",
          fontSize: 120,
          fontWeight: "bold",
          opacity: title,
          translate: () => [0, (1 - title()) * 40],
        }}
      >
        Pictures and videos
      </text>
    </FillFrame>
  )
}

/** The same video twice at once, at two speeds, and another one in a corner. */
function SideBySide() {
  const card = {
    width: 880,
    height: 495,
    borderRadius: 24,
    objectFit: "cover",
    boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
  } as const
  return (
    <FillFrame style={{ flexDirection: "row", gap: 48 }}>
      <div style={{ gap: 16, alignItems: "center" }}>
        <Video src="assets/counter.mp4" style={card} />
        <text style={{ color: "#cbd5e1", fontSize: 36 }}>1×</text>
      </div>
      <div style={{ gap: 16, alignItems: "center" }}>
        <Video src="assets/counter.mp4" playbackRate={2} muted style={card} />
        <text style={{ color: "#cbd5e1", fontSize: 36 }}>2×</text>
      </div>
      <div style={{ position: "absolute", right: 48, bottom: 48 }}>
        <Video src="assets/bars.mp4" style={{ width: 384, height: 216, borderRadius: 12 }} />
      </div>
    </FillFrame>
  )
}
