import { Clip, ClipSequence } from "../src/lib/clip"
import { seconds } from "../src/lib/frame"
import { FillFrame } from "../src/lib/layout/fill-frame"
import { Project, type ProjectSettings } from "../src/lib/project"
import { TimeLine } from "../src/lib/timeline"
import { AnimationHandle, useAnimation, useVariable, type Vec2 } from "../src/lib/animation"
import { cubicBezier, easeOutCubic, easeOutExpo } from "../src/lib/animation/functions"
import { Video } from "../src/lib/video/video"

export const PROJECT_SETTINGS: ProjectSettings = {
  name: "framescript-motion-demo",
  width: 1920,
  height: 1080,
  fps: 60,
}

const LETTERS = ["F", "R", "A", "M", "E", "S", "C", "R", "I", "P", "T"] as const
const DIRECTIONS: Vec2[] = [
  { x: -1.2, y: 0.3 },
  { x: 1.1, y: -0.4 },
  { x: 0.2, y: -1.3 },
  { x: -0.5, y: 1.2 },
  { x: 1.3, y: 0.6 },
  { x: -1.1, y: -0.8 },
  { x: 0.8, y: 1.2 },
  { x: -0.9, y: 0.9 },
  { x: 1.0, y: -1.1 },
  { x: -1.4, y: 0.2 },
  { x: 0.6, y: 1.4 },
]

const TitleScene = () => {
  const letters = LETTERS.map((char, index) => {
    const dir = DIRECTIONS[index % DIRECTIONS.length]
    const offset = useVariable({ x: dir.x * 240, y: dir.y * 180 })
    const opacity = useVariable(0)
    return { char, offset, opacity, index }
  })
  const scale = useVariable(1)

  const { ready } = useAnimation(async (ctx) => {
    const handles: AnimationHandle[] = []
    await ctx.sleep(seconds(0.2))

    for (const letter of letters) {
      await ctx.sleep(seconds(0.06))
      const move = ctx.move(letter.offset).to({ x: 0, y: 0 }, seconds(0.8), easeOutExpo)
      const fade = ctx.move(letter.opacity).to(1, seconds(0.5), easeOutCubic)
      handles.push(move, fade)
    }

    await ctx.parallel(handles)
    await ctx.sleep(seconds(0.3))

    const overshootEase = cubicBezier(1, 0, .49, 1.77)
    await ctx.move(scale).to(1.2, seconds(0.6), overshootEase)
    await ctx.sleep(seconds(0.8))
  }, [])

  if (!ready) return null

  const left = letters.slice(0, 5)
  const right = letters.slice(5)

  return (
    <FillFrame style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `scale(${scale.use()})`,
          transformOrigin: "center",
          display: "grid",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(1200px 600px at 20% 20%, rgba(59,130,246,0.25), transparent 60%)," +
              "radial-gradient(900px 700px at 80% 35%, rgba(16,185,129,0.22), transparent 60%)," +
              "linear-gradient(180deg, #070a16, #0c1222)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.12,
            background:
              "repeating-linear-gradient(90deg, rgba(255,255,255,0.08) 0 1px, transparent 1px 24px)",
          }}
        />

        <div
          style={{
            margin: "auto",
            display: "flex",
            alignItems: "center",
            gap: 24,
            fontSize: 120,
            fontWeight: 800,
            letterSpacing: "0.08em",
            color: "#e2e8f0",
            textShadow: "0 20px 60px rgba(0,0,0,0.45)",
            fontFamily: "'Trebuchet MS', 'Lucida Grande', 'Arial Black', sans-serif",
          }}
        >
          <div style={{ display: "flex", gap: 18 }}>
            {left.map((letter) => {
              const offset = letter.offset.use()
              const opacity = letter.opacity.use()
              return (
                <span
                  key={letter.index}
                  style={{
                    display: "inline-block",
                    transform: `translate(${offset.x}px, ${offset.y}px)`,
                    opacity,
                  }}
                >
                  {letter.char}
                </span>
              )
            })}
          </div>
          <div style={{ width: 56 }} />
          <div style={{ display: "flex", gap: 18 }}>
            {right.map((letter) => {
              const offset = letter.offset.use()
              const opacity = letter.opacity.use()
              return (
                <span
                  key={letter.index}
                  style={{
                    display: "inline-block",
                    transform: `translate(${offset.x}px, ${offset.y}px)`,
                    opacity,
                  }}
                >
                  {letter.char}
                </span>
              )
            })}
          </div>
        </div>
      </div>
    </FillFrame>
  )
}

export const PROJECT = () => {
  return (
    <Project>
      <TimeLine>
        <ClipSequence>
          <Clip label="FrameScript">
            <TitleScene />
          </Clip>
          <Clip>
            <Video video={{ path: "~/Videos/music.mp4" }} />
          </Clip>
        </ClipSequence>
      </TimeLine>
    </Project>
  )
}
