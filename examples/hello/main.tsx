import {
  BEZIER_OVERSHOOT,
  BEZIER_SMOOTH,
  Clip,
  FillFrame,
  For,
  seconds,
  Sequence,
  Timeline,
  useAnimation,
  useCurrentFrame,
  useGlobalCurrentFrame,
  useVariable,
} from "framescript"

export default function Main() {
  return (
    <Timeline>
      <Sequence>
        <Clip label="intro">
          <Intro />
        </Clip>
        <Clip label="cards">
          <Cards />
        </Clip>
        <Clip label="outro" duration={seconds(2)}>
          <Outro />
        </Clip>
      </Sequence>
      <Clip label="overlay">
        <FrameCounter />
      </Clip>
    </Timeline>
  )
}

/** The circle of FrameScript's README, with a title. */
function Intro() {
  const position = useVariable({ x: -300, y: 0 })
  const opacity = useVariable(0)
  const title = useVariable({ x: 0, y: 40 })
  const titleOpacity = useVariable(0)

  useAnimation(async (ctx) => {
    const move = ctx.move(position).to({ x: 240, y: 0 }, seconds(1.2), BEZIER_SMOOTH)
    const fade = ctx.move(opacity).to(1, seconds(0.6), BEZIER_SMOOTH)
    await ctx.parallel([move, fade])
    await ctx.parallel([
      ctx.move(title).to({ x: 0, y: 0 }, seconds(0.8), BEZIER_OVERSHOOT),
      ctx.move(titleOpacity).to(1, seconds(0.5)),
    ])
    await ctx.sleep(seconds(1))
    await ctx.parallel([
      ctx.move(opacity).to(0, seconds(0.4)),
      ctx.move(titleOpacity).to(0, seconds(0.4)),
    ])
  })

  return (
    <FillFrame style={{ gap: 48 }}>
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: 999,
          background: "#38bdf8",
          opacity,
          translate: () => [position().x, position().y],
          boxShadow: "0 20px 60px rgba(56,189,248,0.35)",
        }}
      />
      <text
        style={{
          color: "#e2e8f0",
          fontSize: 96,
          fontWeight: "bold",
          opacity: titleOpacity,
          translate: () => [title().x, title().y],
        }}
      >
        FrameScript2
      </text>
    </FillFrame>
  )
}

const CARDS = [
  { title: "AntiWebUI", body: "wgpu で描く", color: "#f472b6" },
  { title: "TSX", body: "Solid 風の差分更新", color: "#a78bfa" },
  { title: "op2", body: "JSON を使わない", color: "#34d399" },
]

/** Cards that come in one after another. */
function Cards() {
  return (
    <FillFrame style={{ flexDirection: "row", gap: 40 }}>
      <For each={CARDS}>{(card, i) => <Card {...card} index={i} />}</For>
    </FillFrame>
  )
}

function Card(props: { title: string; body: string; color: string; index: number }) {
  const lift = useVariable(80)
  const opacity = useVariable(0)
  const tint = useVariable("#1e293b")

  useAnimation(async (ctx) => {
    await ctx.sleep(seconds(0.25) * props.index)
    await ctx.parallel([
      ctx.move(lift).to(0, seconds(0.7), BEZIER_OVERSHOOT),
      ctx.move(opacity).to(1, seconds(0.5)),
    ])
    await ctx.move(tint).to("#334155", seconds(0.5))
    await ctx.waitUntil(seconds(3))
    await ctx.parallel([
      ctx.move(lift).to(-60, seconds(0.5), BEZIER_SMOOTH),
      ctx.move(opacity).to(0, seconds(0.5)),
    ])
  })

  return (
    <div
      style={{
        width: 360,
        padding: "32px 36px",
        gap: 16,
        flexDirection: "column",
        borderRadius: 24,
        background: tint,
        borderTopWidth: 6,
        borderColor: props.color,
        opacity,
        translateY: lift,
        boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
      }}
    >
      <text style={{ color: props.color, fontSize: 44, fontWeight: 700 }}>{props.title}</text>
      <text style={{ color: "#cbd5e1", fontSize: 30 }}>{props.body}</text>
    </div>
  )
}

function Outro() {
  const frame = useCurrentFrame()
  return (
    <FillFrame>
      <text
        style={{
          color: "#f8fafc",
          fontSize: 120,
          fontWeight: 800,
          opacity: () => Math.min(1, frame() / seconds(0.5)),
          scale: () => 0.9 + 0.1 * Math.min(1, frame() / seconds(2)),
        }}
      >
        Thanks!
      </text>
    </FillFrame>
  )
}

function FrameCounter() {
  const frame = useGlobalCurrentFrame()
  return (
    <div style={{ position: "absolute", right: 32, bottom: 24 }}>
      <text style={{ color: "rgba(226,232,240,0.6)", fontSize: 24 }}>
        frame {frame}
      </text>
    </div>
  )
}
