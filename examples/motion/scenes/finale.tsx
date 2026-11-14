// The finale: confetti out of the drop, and the mark built of the three figures of the start, with
// the name and what it is. Then it all goes back into the point, and the point goes.
import { For, useCurrentFrame } from "framescript"
import { BAR, useThump } from "../beat.ts"
import { C, DISPLAY, inBack, JP, MONO, outBack, outElastic, outExpo, outQuint, rand, span } from "../design.ts"
import { Rise } from "../parts.tsx"

const CX = 960
const CY = 500

const KINDS = ["circle", "triangle", "square", "squiggle", "ring", "plus"] as const
const PIECES = Array.from({ length: 72 }, (_, i) => {
  const a = rand(i, 1) * Math.PI * 2
  const speed = 22 + rand(i, 2) * 46
  return {
    i,
    kind: KINDS[i % KINDS.length],
    color: [C.red, C.yellow, C.blue, C.ink][Math.floor(rand(i, 3) * 4)],
    vx: Math.cos(a) * speed,
    vy: Math.sin(a) * speed - 10,
    spin: (rand(i, 4) - 0.5) * 16,
    size: 0.6 + rand(i, 5) * 0.9,
    delay: rand(i, 6) * 4,
  }
})

/** Where a piece is `t` frames after it was thrown: slowed by the air, and falling. */
function flight(p: (typeof PIECES)[number], t: number): [number, number] {
  const k = 0.07
  const g = 0.55
  const e = (1 - Math.exp(-k * t)) / k
  return [CX + p.vx * e, CY + p.vy * e + (g / k) * (t - e)]
}

export function FinaleScene() {
  const frame = useCurrentFrame()
  const thump = useThump()
  // Everything goes back into the point in the last bar.
  const end = BAR * 3
  const back = () => span(frame(), end + 30, 30, (t) => inBack(t, 2))
  return (
    <div style={{ position: "absolute", inset: 0, background: C.paper }}>
      <svg viewBox="0 0 1920 1080" style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080 }} fill="none" stroke={C.rule}>
        {/* Rings behind the mark, turning slowly. */}
        <For each={[300, 420, 560]}>
          {(r, i) => (
            <circle
              cx={CX}
              cy={CY}
              r={r}
              strokeWidth={2}
              strokeDasharray={i === 1 ? "2 14" : "none"}
              transform={() => `rotate(${frame() * (i % 2 ? -0.2 : 0.15)} ${CX} ${CY})`}
              trim={() => [0, span(frame(), 30 + i * 10, 60, outQuint) * (1 - back())]}
            />
          )}
        </For>
        {/* A ring out of the mark on each bar. */}
        <For each={[BAR, BAR * 2]}>
          {(at) => {
            const t = () => span(frame(), at, 50, outExpo)
            return <circle cx={CX - 470} cy={CY} r={() => 130 + 500 * t()} stroke={C.ink} strokeWidth={() => 6 * (1 - t())} opacity={() => (frame() >= at ? 1 - t() : 0)} />
          }}
        </For>
      </svg>
      <Confetti />

      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1920,
          height: 1000,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 56,
        }}
      >
        <div style={{ width: 260, height: 260, scale: () => (1 + 0.05 * thump()) * (1 - back()), translate: () => [470 * back(), 0] }}>
          <Mark />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Rise
            text="FrameScript"
            at={40}
            out={end}
            stagger={2}
            length={28}
            size={150}
            room={1.25}
            style={{ fontFamily: DISPLAY, fontWeight: 900, letterSpacing: -4, color: C.ink }}
            letter={(i) => ({ color: i >= 5 ? C.red : C.ink })}
          />
          <Typed text="Motion graphics, written in TSX." at={84} out={end - 10} />
          <text
            style={{
              fontFamily: JP,
              fontWeight: 700,
              fontSize: 34,
              color: C.ink,
              marginTop: 18,
              letterSpacing: 4,
              opacity: () => span(frame(), 130, 20) * (1 - span(frame(), end, 14)),
              translate: () => [0, 20 * (1 - span(frame(), 130, 30, outQuint))],
            }}
          >
            動きを、コードで。
          </text>
        </div>
      </div>
      <text
        style={{
          position: "absolute",
          left: 0,
          width: 1920,
          bottom: 110,
          textAlign: "center",
          fontFamily: MONO,
          fontSize: 20,
          letterSpacing: 4,
          color: C.ink,
          opacity: () => span(frame(), 170, 24) * (1 - span(frame(), end, 14)) * 0.75,
        }}
      >
        ONE TSX PROJECT · SVG, TYPE AND WGSL · NO BROWSER
      </text>

      {/* The point it all ends in, and its going. */}
      <svg viewBox="0 0 1920 1080" style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080 }}>
        <circle
          cx={CX}
          cy={CY}
          r={() => {
            const f = frame()
            const come = outBack(span(f, end + 52, 14), 2.4)
            const go = span(f, end + 80, 12, (t) => inBack(t, 3))
            return Math.max(0, 22 * come * (1 - go))
          }}
          fill={C.ink}
        />
      </svg>
    </div>
  )
}

/** The mark: a dark square with rounded corners and the three figures in it. */
function Mark() {
  const frame = useCurrentFrame()
  const pop = (at: number) => outElastic(span(frame(), at, 40))
  return (
    <svg viewBox="0 0 260 260" style={{ width: 260, height: 260 }}>
      <g transform={() => `translate(130 130) scale(${outBack(span(frame(), 30, 20), 1.8)}) translate(-130 -130)`}>
        <rect x={10} y={10} width={240} height={240} rx={56} fill={C.ink} />
      </g>
      <rect x={10} y={10} width={240} height={240} rx={56} fill="none" stroke={C.ink} strokeWidth={10} trim={() => [0, span(frame(), 6, 30, outQuint)]} />
      <g transform={() => `translate(82 84) scale(${pop(42)})`}>
        <circle r={34} fill={C.red} />
      </g>
      <g transform={() => `translate(82 176) rotate(${(1 - pop(48)) * 90}) scale(${pop(48)})`}>
        <rect x={-30} y={-30} width={60} height={60} fill={C.blue} />
      </g>
      <g transform={() => `translate(168 130) scale(${pop(54)})`}>
        <polygon points="-32,-58 56,0 -32,58" fill={C.yellow} />
      </g>
    </svg>
  )
}

/** Text typed in from `at`, a letter at a time, with a caret after it; taken back from `out`. */
function Typed(props: { text: string; at: number; out: number }) {
  const frame = useCurrentFrame()
  const shown = () => {
    const f = frame()
    const typed = Math.floor(Math.max(0, f - props.at) / 1.5)
    const erased = Math.floor(Math.max(0, f - props.out) / 0.6)
    return Math.max(0, Math.min(props.text.length, typed) - erased)
  }
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "center", height: 44, marginTop: 6 }}>
      <text style={{ fontFamily: MONO, fontSize: 32, color: C.ink, whiteSpace: "pre" }}>{() => props.text.slice(0, shown())}</text>
      <div
        style={{
          width: 16,
          height: 34,
          marginLeft: 4,
          background: C.red,
          opacity: () => {
            const f = frame()
            if (f < props.at - 10 || f > props.out + props.text.length * 0.6 + 10) return 0
            return Math.floor(f / 16) % 2 === 0 || (f > props.at && shown() < props.text.length) ? 1 : 0
          },
        }}
      />
    </div>
  )
}

function Confetti() {
  const frame = useCurrentFrame()
  return (
    <svg viewBox="0 0 1920 1080" style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080 }} strokeLinecap="round" strokeLinejoin="round">
      <For each={PIECES}>
        {(p) => {
          const transform = () => {
            const t = Math.max(0, frame() - p.delay)
            const [x, y] = flight(p, t)
            const s = p.size * outBack(Math.min(1, t / 8), 2) * (t > 0 ? 1 : 0)
            return `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(p.spin * t).toFixed(1)}) scale(${s.toFixed(3)})`
          }
          const visible = () => (frame() < 200 ? 1 : 0)
          return (
            <g transform={transform} opacity={visible}>
              {piece(p.kind, p.color)}
            </g>
          )
        }}
      </For>
    </svg>
  )
}

function piece(kind: (typeof KINDS)[number], color: string) {
  switch (kind) {
    case "circle":
      return <circle r={14} fill={color} />
    case "triangle":
      return <polygon points="0,-18 16,12 -16,12" fill={color} />
    case "square":
      return <rect x={-12} y={-12} width={24} height={24} fill={color} />
    case "squiggle":
      return <polyline points="-24,6 -12,-6 0,6 12,-6 24,6" fill="none" stroke={color} strokeWidth={6} />
    case "ring":
      return <circle r={13} fill="none" stroke={color} strokeWidth={6} />
    default:
      return <path d="M-14 0H14M0 -14V14" stroke={color} strokeWidth={7} />
  }
}
