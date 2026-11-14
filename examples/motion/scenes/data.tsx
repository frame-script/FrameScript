// Data: an infographic that builds itself in the dark, counters, a ring, bars and a line, and nods
// along to the kick until it all goes up and away.
import { For, linearGradient, useCurrentFrame } from "framescript"
import { BEAT, useThump } from "../beat.ts"
import { C, DISPLAY, inCubic, inOutCubic, MONO, mix, outBack, outExpo, outQuint, rand, span } from "../design.ts"
import { CropMarks, Label, Rise, rolled, Slot } from "../parts.tsx"

/** Up and out of sight from `at`, the part `i` a little after the one before. */
function away(f: number, i: number) {
  const t = span(f, 428 + i * 6, 30, inCubic)
  return { opacity: 1 - t, y: -120 * t }
}

export function DataScene() {
  const frame = useCurrentFrame()
  const leave = (i: number) => ({
    opacity: () => away(frame(), i).opacity,
    translate: () => [0, away(frame(), i).y] as [number, number],
  })
  return (
    <div style={{ position: "absolute", inset: 0, background: C.ink }}>
      <CropMarks at={4} color={C.paper} />
      <Label index="03" name="DATA" at={10} color={C.paper} style={{ left: 120, top: 104, ...leave(0) }} />
      <text style={{ position: "absolute", right: 120, top: 104, fontFamily: MONO, fontSize: 20, letterSpacing: 3, color: C.paper, opacity: () => span(frame(), 24, 20) * away(frame(), 0).opacity }}>
        EVERY VALUE IS A FUNCTION OF THE FRAME
      </text>
      <div style={{ position: "absolute", left: 120, top: 160, ...leave(0) }}>
        <Rise text="Numbers that move." at={8} stagger={1} length={24} size={76} room={1.25} style={{ fontFamily: DISPLAY, fontWeight: 900, color: C.paper, letterSpacing: -1 }} />
      </div>

      <div style={{ position: "absolute", left: 120, top: 330, width: 500, ...leave(1) }}>
        <Counters />
      </div>
      <div style={{ position: "absolute", left: 700, top: 300, width: 480, height: 480, ...leave(2) }}>
        <Ring />
      </div>
      <div style={{ position: "absolute", left: 1280, top: 300, width: 520, height: 480, ...leave(3) }}>
        <Bars />
      </div>
      <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, ...leave(4) }}>
        <Line />
      </div>
    </div>
  )
}

function Counters() {
  const frame = useCurrentFrame()
  const count = (to: number, at: number, length = 60) => () => String(Math.round(to * span(frame(), at, length, outExpo)))
  const fade = (at: number) => () => span(frame(), at, 16)
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <text style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 250, lineHeight: 1, color: C.paper, letterSpacing: -8, opacity: fade(20) }}>
        {count(60, 20)}
      </text>
      <div style={{ height: 4, background: C.mint, marginTop: 14, width: () => 420 * span(frame(), 34, 40, outExpo) }} />
      <text style={{ fontFamily: MONO, fontSize: 22, letterSpacing: 5, color: C.paper, marginTop: 18, opacity: fade(44) }}>FRAMES PER SECOND</text>
      <div style={{ display: "flex", flexDirection: "row", gap: 56, marginTop: 56 }}>
        <For each={[{ value: 120, label: "BPM", at: 70 }, { value: 44, label: "SECONDS", at: 80 }, { value: 2640, label: "FRAMES", at: 90 }]}>
          {(s) => (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, opacity: fade(s.at) }}>
              <text style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 54, lineHeight: 1, color: C.yellow }}>{count(s.value, s.at, 50)}</text>
              <text style={{ fontFamily: MONO, fontSize: 18, letterSpacing: 4, color: C.paper, opacity: 0.7 }}>{s.label}</text>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

const SLICES = [
  { share: 0.38, color: C.red, name: "SVG" },
  { share: 0.27, color: C.yellow, name: "TYPE" },
  { share: 0.2, color: C.blue, name: "MATH" },
  { share: 0.15, color: C.mint, name: "WGSL" },
]

/** A ring in four parts, drawn one after another; then the beat picks one after another out. */
function Ring() {
  const frame = useCurrentFrame()
  const thump = useThump()
  const [cx, cy, r] = [240, 200, 160]
  const picks = Array.from({ length: 8 }, (_, i) => 180 + i * BEAT)
  const picked = () => {
    const k = Math.floor(rolled(frame(), picks, 1))
    return k === 0 ? -1 : (k - 1) % SLICES.length
  }
  let before = 0
  const parts = SLICES.map((s, i) => {
    const from = before
    before += s.share
    return { ...s, from, to: before, i }
  })
  return (
    <>
      <svg viewBox="0 0 480 480" style={{ position: "absolute", left: 0, top: 0, width: 480, height: 480 }} fill="none">
        <circle cx={cx} cy={cy} r={r} stroke={C.ruleDark} strokeWidth={44} trim={() => [0, span(frame(), 16, 40, outQuint)]} transform={`rotate(-90 ${cx} ${cy})`} />
        <g transform={() => `rotate(${-90 + 30 * (1 - span(frame(), 40, 90, outQuint))} ${cx} ${cy})`}>
          <For each={parts}>
            {(p) => {
              const drawn = () => span(frame(), 40 + p.i * 12, 30, inOutCubic)
              const lift = () => (picked() === p.i ? 1 : 0)
              return (
                <circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  stroke={p.color}
                  strokeWidth={() => 44 + 16 * lift() + 10 * lift() * thump()}
                  strokeOpacity={() => (picked() < 0 || lift() ? 1 : 0.35)}
                  trim={() => [p.from + 0.006, mix(p.from + 0.006, p.to - 0.006, drawn())]}
                />
              )
            }}
          </For>
        </g>
      </svg>
      {/* What the picked part is, in the middle. */}
      <div style={{ position: "absolute", left: cx - 120, top: cy - 50, width: 240, display: "flex", flexDirection: "column", alignItems: "center", opacity: () => span(frame(), 90, 20) }}>
        <Slot
          words={["100%", ...parts.map((p) => `${Math.round(p.share * 100)}%`), ...parts.map((p) => `${Math.round(p.share * 100)}%`)]}
          index={() => rolled(frame(), picks, 10)}
          size={64}
          style={{ fontFamily: DISPLAY, fontWeight: 900, color: C.paper }}
        />
        <Slot
          words={["ALL", ...parts.map((p) => p.name), ...parts.map((p) => p.name)]}
          index={() => rolled(frame(), picks, 10)}
          size={18}
          style={{ fontFamily: MONO, letterSpacing: 5, color: C.paper }}
        />
      </div>
      <div style={{ position: "absolute", left: 30, top: 420, width: 420, display: "flex", flexDirection: "row", justifyContent: "space-between" }}>
        <For each={parts}>
          {(p) => (
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, opacity: () => span(frame(), 70 + p.i * 8, 16) * (picked() < 0 || picked() === p.i ? 1 : 0.4) }}>
              <div style={{ width: 14, height: 14, background: p.color }} />
              <text style={{ fontFamily: MONO, fontSize: 18, letterSpacing: 3, color: C.paper }}>{p.name}</text>
            </div>
          )}
        </For>
      </div>
    </>
  )
}

const VALUES = [0.42, 0.58, 0.5, 0.72, 0.64, 0.86, 0.78, 0.94, 1.0]

/** Bars that grow one after another and jump a little on each kick. */
function Bars() {
  const frame = useCurrentFrame()
  const thump = useThump()
  const [base, tall, w, gap] = [380, 320, 38, 20]
  const fill = linearGradient([C.yellow, C.red], { x1: 0, y1: 0, x2: 0, y2: 1 })
  return (
    <svg viewBox="0 0 520 480" style={{ position: "absolute", left: 0, top: 0, width: 520, height: 480 }}>
      <For each={[0.25, 0.5, 0.75, 1]}>
        {(k) => (
          <path d={`M0 ${base - tall * k}H520`} stroke={C.ruleDark} strokeWidth={1.5} strokeDasharray="3 7" trim={() => [0, span(frame(), 50 + k * 20, 30, outQuint)]} />
        )}
      </For>
      <For each={VALUES}>
        {(v, i) => {
          const h = () => {
            const f = frame()
            const grow = outBack(span(f, 70 + i * 5, 30), 1.8)
            const jump = 1 + 0.1 * thump() * (0.4 + rand(i, Math.floor((f + 600) / BEAT)))
            return Math.max(0, tall * v * grow * jump)
          }
          return <rect x={14 + i * (w + gap)} y={() => base - h()} width={w} height={h} fill={fill} />
        }}
      </For>
      <path d={`M0 ${base}H520`} stroke={C.paper} strokeWidth={3} trim={() => [0, span(frame(), 60, 30, outExpo)]} />
    </svg>
  )
}

/** A line along the bottom that draws itself, the ground under it filling in as it goes. */
function Line() {
  const frame = useCurrentFrame()
  const [left, right, top, bottom] = [120, 1800, 820, 990]
  const values = Array.from({ length: 22 }, (_, i) => 0.18 + (i / 21) * 0.6 + 0.16 * Math.sin(i * 1.3) + 0.08 * rand(i, 9))
  const points = curve(values.map((v, i) => [mix(left, right, i / 21), mix(bottom, top, v)] as [number, number]))
  const lengths = [0]
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
  const total = lengths[lengths.length - 1]
  const d = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("")
  const area = `${d}L${right} ${bottom}L${left} ${bottom}Z`
  const drawn = () => span(frame(), 130, 110, inOutCubic)
  const tip = () => {
    const at = drawn() * total
    let i = 1
    while (i < lengths.length - 1 && lengths[i] < at) i++
    const k = (at - lengths[i - 1]) / Math.max(1e-6, lengths[i] - lengths[i - 1])
    return [mix(points[i - 1][0], points[i][0], k), mix(points[i - 1][1], points[i][1], k)]
  }
  const shown = () => (frame() >= 130 ? 1 : 0)
  return (
    <svg viewBox="0 0 1920 1080" style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080 }} fill="none">
      <For each={[0, 1, 2, 3]}>
        {(k) => <path d={`M${left} ${bottom - k * 56}H${right}`} stroke={C.ruleDark} strokeWidth={1.5} trim={() => [0, span(frame(), 110 + k * 6, 40, outQuint)]} />}
      </For>
      <g clip={() => [left, top - 60, tip()[0] - left, bottom - top + 60]}>
        <path d={area} fill={linearGradient([[0, "rgba(58, 214, 166, 0.45)"], [1, "rgba(58, 214, 166, 0)"]], { x1: 0, y1: 0, x2: 0, y2: 1 })} />
      </g>
      <path d={d} stroke={C.mint} strokeWidth={5} strokeLinejoin="round" strokeLinecap="round" trim={() => [0, drawn()]} />
      <circle cx={() => tip()[0]} cy={() => tip()[1]} r={() => (18 + 6 * Math.sin(frame() / 5)) * shown()} fill="rgba(58, 214, 166, 0.25)" />
      <circle cx={() => tip()[0]} cy={() => tip()[1]} r={() => 8 * shown()} fill={C.paper} />
    </svg>
  )
}

/** A smooth curve through `points` (Catmull-Rom), as many short straight pieces. */
function curve(points: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [points[Math.max(0, i - 1)], points[i], points[i + 1], points[Math.min(points.length - 1, i + 2)]]
    for (let s = 0; s < 16; s++) {
      const t = s / 16
      const [t2, t3] = [t * t, t * t * t]
      const at = (k: 0 | 1) =>
        0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)
      out.push([at(0), at(1)])
    }
  }
  out.push(points[points.length - 1])
  return out
}
