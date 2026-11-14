// Point, line, plane: a dot splits in three, each draws a shape as it goes round, and the shapes take
// their colors (Kandinsky's: a blue circle, a red square, a yellow triangle). Then they are pulled
// back into the point the next scene comes out of.
import { For, useCurrentFrame } from "framescript"
import { BEAT } from "../beat.ts"
import { C, clamp01, inCubic, inExpo, inOutCubic, MONO, mix, outBack, outElastic, outQuint, span } from "../design.ts"
import { CropMarks, Label, Rise } from "../parts.tsx"

const CX = 960
const CY = 500

type Kind = "circle" | "square" | "triangle"

interface Figure {
  kind: Kind
  name: string
  color: string
  /** Where it stands in the row. */
  x: number
  /** Corners of its outline from where drawing starts, round clockwise; none for the circle. */
  corners: [number, number][]
}

const R = 150
const S = 134
const T = 176
const TRIANGLE: [number, number][] = [
  [0, -T],
  [T * Math.cos(Math.PI / 6), T / 2],
  [-T * Math.cos(Math.PI / 6), T / 2],
]

const FIGURES: Figure[] = [
  { kind: "circle", name: "CIRCLE", color: C.blue, x: CX - 470, corners: [] },
  { kind: "square", name: "SQUARE", color: C.red, x: CX, corners: [[-S, -S], [S, -S], [S, S], [-S, S]] },
  { kind: "triangle", name: "TRIANGLE", color: C.yellow, x: CX + 470, corners: TRIANGLE },
]

/** Where along its outline a figure's drawing is, at `t` of the way round. */
function tip(f: Figure, t: number): [number, number] {
  if (f.kind === "circle") return [Math.cos(t * Math.PI * 2) * R, Math.sin(t * Math.PI * 2) * R]
  const c = f.corners
  const lengths = c.map((p, i) => Math.hypot(c[(i + 1) % c.length][0] - p[0], c[(i + 1) % c.length][1] - p[1]))
  let at = clamp01(t) * lengths.reduce((a, b) => a + b, 0)
  for (let i = 0; i < c.length; i++) {
    if (at <= lengths[i] || i === c.length - 1) {
      const [p, q] = [c[i], c[(i + 1) % c.length]]
      const k = Math.min(1, at / lengths[i])
      return [mix(p[0], q[0], k), mix(p[1], q[1], k)]
    }
    at -= lengths[i]
  }
  return c[0]
}

function outlineOf(f: Figure, at: [number, number] = [0, 0]): string {
  if (f.kind === "circle") {
    const [x, y] = at
    const k = 0.5522847498 * R
    return (
      `M${x + R} ${y}C${x + R} ${y + k} ${x + k} ${y + R} ${x} ${y + R}C${x - k} ${y + R} ${x - R} ${y + k} ${x - R} ${y}` +
      `C${x - R} ${y - k} ${x - k} ${y - R} ${x} ${y - R}C${x + k} ${y - R} ${x + R} ${y - k} ${x + R} ${y}Z`
    )
  }
  return f.corners.map(([x, y], i) => `${i ? "L" : "M"}${x + at[0]} ${y + at[1]}`).join("") + "Z"
}

/** Where everything is pulled in from frame 240 to 350: how far round, how far out, how big. */
function pull(f: number) {
  const spin = 360 * 2.5 * inCubic(span(f, 240, 112))
  const gather = span(f, 240, 34, inOutCubic)
  const radius = 300 * (1 - span(f, 268, 84, inExpo))
  const scale = mix(1, 0.14, span(f, 262, 88, inCubic)) * (1 - span(f, 350, 8))
  return { spin, gather, radius, scale }
}

export function PointScene() {
  const frame = useCurrentFrame()
  const guides = () => span(frame(), 0, 44, outQuint) * (1 - span(frame(), 236, 40))
  return (
    <div style={{ position: "absolute", inset: 0, background: C.paper }}>
      {/* Construction lines through the middle, and a circle of them. */}
      <svg viewBox="0 0 1920 1080" style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, opacity: guides }} fill="none" stroke={C.ink} strokeWidth={1.5}>
        <path d={`M0 ${CY}H1920`} strokeOpacity={0.22} trim={() => [0.5 - guides() / 2, 0.5 + guides() / 2]} />
        <path d={`M${CX} 0V1080`} strokeOpacity={0.22} trim={() => [0.5 - guides() / 2, 0.5 + guides() / 2]} />
        <circle cx={CX} cy={CY} r={330} strokeOpacity={0.22} strokeDasharray="4 10" trim={() => [0, span(frame(), 14, 60, outQuint)]} />
        <For each={FIGURES}>
          {(fig) => <path d={`M${fig.x} ${CY - 260}V${CY + 330}`} strokeOpacity={0.12} trim={() => [0, span(frame(), 70, 40, outQuint)]} />}
        </For>
      </svg>
      <CropMarks at={6} />
      <Label index="00" name="POINT, LINE, PLANE" at={36} style={{ left: 120, top: 104, opacity: () => 1 - span(frame(), 236, 30) }} />
      <text
        style={{
          position: "absolute",
          right: 120,
          top: 104,
          fontFamily: MONO,
          fontSize: 20,
          letterSpacing: 3,
          color: C.ink,
          opacity: () => span(frame(), 50, 30) * (1 - span(frame(), 236, 30)),
        }}
      >
        AFTER KANDINSKY, 1926
      </text>

      {/* The rings that pull everything in. */}
      <svg viewBox="0 0 1920 1080" style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080 }} fill="none" stroke={C.ink}>
        <For each={[[236, 44], [262, 40], [284, 36], [300, 32], [312, 28], [322, 24], [330, 20], [336, 16]]}>
          {([start, length]) => {
            const t = () => span(frame(), start, length, (x) => x * x)
            return (
              <circle
                cx={CX}
                cy={CY}
                r={() => 30 + 900 * (1 - t())}
                strokeWidth={() => 1 + 5 * t()}
                opacity={() => (frame() < start ? 0 : Math.min(t() * 4, 1) * (1 - span(frame(), start + length - 3, 3)))}
              />
            )
          }}
        </For>
      </svg>

      <svg viewBox="0 0 1920 1080" style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080 }}>
        <For each={FIGURES}>{(fig, i) => <Shape fig={fig} index={i} />}</For>
        <Dots />
        {/* What everything was pulled into, which the next scene opens out of. */}
        <circle cx={CX} cy={CY} r={() => 22 * span(frame(), 343, 12, (t) => outBack(t, 2))} fill={C.ink} />
      </svg>

      <For each={FIGURES}>
        {(fig, i) => (
          <div
            style={{
              position: "absolute",
              left: fig.x - 200,
              top: CY + 220,
              width: 400,
              display: "flex",
              justifyContent: "center",
              opacity: () => 1 - span(frame(), 240, 20),
            }}
          >
            <Rise text={`0${i + 1} — ${fig.name}`} at={124 + i * 5} out={240} stagger={1} size={24} room={1.4} style={{ fontFamily: MONO, color: C.ink, letterSpacing: 2 }} />
          </div>
        )}
      </For>
    </div>
  )
}

/** One figure: its outline drawn by its dot, then its color under it, set a little off. */
function Shape(props: { fig: Figure; index: number }) {
  const frame = useCurrentFrame()
  const fig = props.fig
  const i = props.index
  const drawn = () => span(frame(), 90 + i * 4, 36, inOutCubic)
  const filled = () => span(frame(), 118 + i * 5, 26, (t) => outBack(t, 2.2))
  // Something different on each beat of the second bar.
  const beat = () => span(frame(), 150 + i * BEAT, 26)
  const hop = () => (fig.kind === "square" ? 0 : Math.sin(Math.PI * clamp01(beat() * 1.15)) * (fig.kind === "circle" ? 90 : 60))
  const turn = () => (fig.kind === "square" ? 90 * outBack(beat(), 2.4) : fig.kind === "triangle" ? 120 * span(frame(), 150 + i * BEAT, 22, inOutCubic) : 0)
  const squash = () => {
    if (fig.kind !== "circle") return [1, 1]
    const land = span(frame(), 150 + 20, 12)
    const k = Math.sin(Math.PI * land) * 0.22
    return [1 + k, 1 - k]
  }
  const transform = () => {
    const f = frame()
    const p = pull(f)
    const a = (((-90 + 120 * i) * Math.PI) / 180) + (p.spin * Math.PI) / 180
    const x = mix(fig.x, CX + Math.cos(a) * p.radius, p.gather)
    const y = mix(CY - hop(), CY + Math.sin(a) * p.radius, p.gather)
    const [sx, sy] = squash()
    return `translate(${x} ${y}) rotate(${turn() + p.spin * 0.6}) scale(${sx * p.scale} ${sy * p.scale})`
  }
  return (
    <g transform={transform}>
      <g transform={() => `translate(16 16) scale(${filled()})`}>
        <path d={outlineOf(fig)} fill={fig.color} />
      </g>
      <path d={outlineOf(fig)} fill="none" stroke={C.ink} strokeWidth={7} strokeLinejoin="round" strokeLinecap="round" trim={() => [0, drawn()]} />
    </g>
  )
}

/** The point: it comes, splits in three, and each goes round its figure drawing it. */
function Dots() {
  const frame = useCurrentFrame()
  return (
    <For each={FIGURES}>
      {(fig, i) => {
        const at = () => {
          const f = frame()
          const start = tip(fig, 0)
          if (f < 90 + i * 4) {
            const go = span(f, 60 + i * 4, 28, (t) => outBack(t, 1.4))
            return [mix(CX, fig.x + start[0], go), mix(CY, CY + start[1], go)]
          }
          const [x, y] = tip(fig, span(f, 90 + i * 4, 36, inOutCubic))
          return [fig.x + x, CY + y]
        }
        const r = () => {
          const f = frame()
          const pop = outElastic(span(f, 30, 40))
          const travel = span(f, 60, 20)
          const gone = span(f, 124 + i * 4, 10)
          return Math.max(0, pop * mix(24, 13, travel) * (1 - gone))
        }
        return <circle cx={() => at()[0]} cy={() => at()[1]} r={r} fill={C.ink} />
      }}
    </For>
  )
}
