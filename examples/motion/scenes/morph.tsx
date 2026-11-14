// Shape: one figure that turns into another on every beat, over a field of dots the kick sends waves
// through. At the end it is a dark circle, which grows over everything into the next scene.
import { For, useCurrentFrame, useGlobalCurrentFrame } from "framescript"
import { BEAT, sinceKick } from "../beat.ts"
import { C, DISPLAY, inCubic, inExpo, MONO, mix, mixHex, outBack, outElastic, outQuint, span } from "../design.ts"
import { CropMarks, Label, rolled, Slot } from "../parts.tsx"
import { between, blob, circle, flower, heart, N, outline, type Points, polygon, square, star } from "../shapes.ts"

const CX = 960
const CY = 520
const R = 230

/** What it turns into, a beat each. The first is there from the start. */
const STEPS: { name: string; color: string; points: (f: number) => Points }[] = [
  { name: "CIRCLE", color: C.blue, points: () => circle(R) },
  { name: "SQUARE", color: C.red, points: () => square(R * 1.12) },
  { name: "TRIANGLE", color: C.yellow, points: () => polygon(3, R * 1.18) },
  { name: "STAR", color: C.blue, points: () => star(5, R * 1.15, R * 0.5) },
  { name: "HEXAGON", color: C.red, points: () => polygon(6, R * 1.05) },
  { name: "FLOWER", color: C.yellow, points: () => flower(8, R * 1.05) },
  { name: "HEART", color: C.red, points: () => heart(R * 1.1) },
  { name: "BLOB", color: C.blue, points: (f) => blob(R, f / 14) },
  { name: "DIAMOND", color: C.yellow, points: () => polygon(4, R * 1.15) },
  { name: "SPARK", color: C.red, points: () => star(8, R * 1.2, R * 0.42) },
  { name: "PENTAGON", color: C.blue, points: () => polygon(5, R * 1.08) },
  { name: "CROSS", color: C.yellow, points: () => cross(R * 1.05) },
  { name: "PETALS", color: C.red, points: () => flower(5, R * 1.08, 0.3) },
  { name: "OCTAGON", color: C.blue, points: () => polygon(8, R * 1.05) },
  { name: "BLOB", color: C.yellow, points: (f) => blob(R, f / 10 + 2) },
  { name: "CIRCLE", color: C.ink, points: () => circle(R) },
]

/** When each step after the first comes: on the beats. */
const AT = STEPS.slice(1).map((_, i) => BEAT * (i + 1))

/** A plus, its arms `r` out and `a` across, started at the middle of the top. */
function cross(r: number, a = r * 0.36): Points {
  const corners: [number, number][] = [
    [0, -r], [a, -r], [a, -a], [r, -a], [r, a], [a, a], [a, r], [-a, r], [-a, a], [-r, a], [-r, -a], [-a, -a], [-a, -r],
  ]
  const lengths = corners.map((p, i) => Math.hypot(corners[(i + 1) % corners.length][0] - p[0], corners[(i + 1) % corners.length][1] - p[1]))
  const total = lengths.reduce((x, y) => x + y, 0)
  const out = new Float64Array(N * 2)
  let edge = 0
  let before = 0
  for (let i = 0; i < N; i++) {
    const at = (i / N) * total
    while (before + lengths[edge] < at) before += lengths[edge++]
    const t = (at - before) / lengths[edge]
    const [p, q] = [corners[edge], corners[(edge + 1) % corners.length]]
    out[i * 2] = mix(p[0], q[0], t)
    out[i * 2 + 1] = mix(p[1], q[1], t)
  }
  return out
}

/** Which step it is at frame `f`, and how far into turning into it. */
function step(f: number): { index: number; t: number } {
  let index = 0
  for (let i = 0; i < AT.length; i++) if (f >= AT[i]) index = i + 1
  return { index, t: index === 0 ? 1 : span(f, AT[index - 1], 18) }
}

/** The figure at frame `f`: its points, its color, how far round it is. */
function figure(f: number, lag = 0) {
  const { index, t } = step(f - lag)
  const to = STEPS[index]
  const from = STEPS[Math.max(0, index - 1)]
  const k = outBack(t, 1.6)
  return {
    points: index === 0 ? to.points(f) : between(from.points(f), to.points(f), k),
    color: mixHex(from.color, to.color, Math.min(1, t * 2)),
    turn: 45 * (index - 1 + k),
    index,
    t,
  }
}

export function MorphScene() {
  const frame = useCurrentFrame()
  const pop = () => outElastic(span(frame(), 4, 46))
  // At the end it grows over everything.
  const grow = () => 1 + 9 * span(frame(), 436, 44, inExpo)
  const text = () => 1 - span(frame(), 424, 14)
  return (
    <div style={{ position: "absolute", inset: 0, background: C.paper }}>
      <Dots />
      <CropMarks at={10} />
      <Label index="02" name="SHAPES" at={16} style={{ left: 120, top: 104, opacity: text }} />
      <text style={{ position: "absolute", right: 120, top: 104, fontFamily: MONO, fontSize: 20, letterSpacing: 3, color: C.ink, opacity: () => span(frame(), 30, 20) * text() }}>
        120 BPM · A BEAT A SHAPE
      </text>

      <svg viewBox="0 0 1920 1080" style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080 }}>
        {/* What it was, going out as an outline. */}
        <path
          d={() => {
            const f = frame()
            const { index, t } = step(f)
            if (index === 0 || t >= 1) return ""
            const prev = figure(AT[index - 1] - 1)
            return outline(prev.points, CX, CY, 1 + 0.55 * outQuint(t), prev.turn)
          }}
          fill="none"
          stroke={C.ink}
          strokeWidth={3}
          opacity={() => 1 - step(frame()).t}
        />
        <Satellites />
        <path
          d={() => {
            const fig = figure(frame())
            return outline(fig.points, CX + 22, CY + 22, pop() * grow(), fig.turn)
          }}
          fill={C.ink}
        />
        <path
          d={() => {
            const fig = figure(frame())
            return outline(fig.points, CX, CY, pop() * grow(), fig.turn)
          }}
          fill={() => figure(frame()).color}
        />
      </svg>

      <div style={{ position: "absolute", left: 120, bottom: 96, display: "flex", flexDirection: "column", gap: 10, opacity: () => text() * span(frame(), 8, 16), translate: () => [0, 40 * (1 - span(frame(), 8, 26, outQuint))] }}>
        <Slot
          words={STEPS.map((s) => s.name)}
          index={() => rolled(frame(), AT, 12)}
          size={92}
          style={{ fontFamily: DISPLAY, fontWeight: 900, color: C.ink, letterSpacing: -2 }}
        />
        <text style={{ fontFamily: MONO, fontSize: 20, letterSpacing: 3, color: C.ink, opacity: () => span(frame(), 40, 20) }}>
          {`${N} POINTS, EACH TO EACH`}
        </text>
      </div>
      <div style={{ position: "absolute", right: 120, bottom: 104, display: "flex", flexDirection: "row", alignItems: "center", gap: 8, opacity: () => text() * span(frame(), 14, 16), translate: () => [0, 40 * (1 - span(frame(), 14, 26, outQuint))] }}>
        <Slot
          words={STEPS.map((_, i) => String(i + 1).padStart(2, "0"))}
          index={() => rolled(frame(), AT, 12)}
          size={56}
          style={{ fontFamily: MONO, fontWeight: 700, color: C.ink }}
        />
        <text style={{ fontFamily: MONO, fontSize: 56, fontWeight: 700, color: C.rule }}>/16</text>
      </div>
    </div>
  )
}

/** Small copies going round it in the second half, a little behind it in their turning. */
function Satellites() {
  const frame = useCurrentFrame()
  return (
    <For each={[0, 1, 2, 3, 4, 5]}>
      {(i) => (
        <path
          d={() => {
            const f = frame()
            const s = outBack(span(f, 240 + i * 5, 24), 2) * (1 - span(f, 412 + i * 3, 18, inCubic))
            if (s <= 0) return ""
            const fig = figure(f, 4 + i * 2)
            const a = (i / 6) * Math.PI * 2 + f / 40
            const r = 380 + 20 * Math.sin(f / 15 + i)
            return outline(fig.points, CX + Math.cos(a) * r, CY + Math.sin(a) * r * 0.8, 0.17 * s, fig.turn + f)
          }}
          fill={() => figure(frame(), 4 + i * 2).color}
        />
      )}
    </For>
  )
}

/** A field of dots that each kick sends a ring of swelling through, out from the middle. */
function Dots() {
  const frame = useCurrentFrame()
  const global = useGlobalCurrentFrame()
  const dots: [number, number][] = []
  for (let y = 0; y < 8; y++) for (let x = 0; x < 15; x++) dots.push([64 + x * 128, 80 + y * 131])
  return (
    <For each={dots}>
      {([x, y]) => {
        const d = Math.hypot(x - CX, y - CY)
        const scale = () => {
          const f = frame()
          const k = sinceKick(global())
          const wave = Math.exp(-(((d - k * 34) / 90) ** 2)) * Math.exp(-k / 28)
          return outBack(span(f, d / 30, 20), 2.5) * (1 + 2.2 * wave)
        }
        return (
          <div
            style={{
              position: "absolute",
              left: x - 5,
              top: y - 5,
              width: 10,
              height: 10,
              borderRadius: 5,
              background: C.ink,
              opacity: 0.3,
              scale,
            }}
          />
        )
      }}
    </For>
  )
}
