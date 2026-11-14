// The title: the point opens into the dark, lines burst out of it, and the words come up into the
// middle with things to look at around them, all on the beat.
import { For, useCurrentFrame, useGlobalCurrentFrame } from "framescript"
import { BEAT, useThump } from "../beat.ts"
import { C, DISPLAY, inCubic, MONO, outElastic, outExpo, outQuint, rand, span } from "../design.ts"
import { CropMarks, Label, Rise, rolled, Slot } from "../parts.tsx"

const CX = 960
const CY = 500

const BURST = Array.from({ length: 30 }, (_, i) => {
  const a = ((i / 30) * 360 + rand(i, 1) * 8) * (Math.PI / 180)
  return {
    a,
    from: 70 + rand(i, 2) * 60,
    to: 520 + rand(i, 3) * 520,
    color: [C.yellow, C.red, C.blue, C.paper][i % 4],
    width: 4 + rand(i, 4) * 8,
    delay: rand(i, 5) * 6,
  }
})

/** What the slot at the bottom says, a word a beat. */
const MADE_OF = ["CODE", "TSX", "SVG", "WGSL", "TYPE", "TIME", "MATH", "CODE"]

export function TitleScene() {
  const frame = useCurrentFrame()
  const global = useGlobalCurrentFrame()
  const thump = useThump()
  const iris = (delay: number) => () => 22 + 1300 * span(frame(), delay, 22, outQuint)
  const lines = () => span(frame(), 60, 40, outExpo) * (1 - span(frame(), 318, 20, inCubic))
  return (
    <div style={{ position: "absolute", inset: 0, background: C.paper }}>
      <svg viewBox="0 0 1920 1080" style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080 }}>
        <circle cx={CX} cy={CY} r={iris(0)} fill={C.red} />
        <circle cx={CX} cy={CY} r={iris(4)} fill={C.ink} />
        {/* Lines out of the point, each a stroke whose two ends fly out one after the other. */}
        <For each={BURST}>
          {(b) => {
            const head = () => span(frame(), 2 + b.delay, 26, outExpo)
            const tail = () => span(frame(), 6 + b.delay, 30, inCubic)
            const [c, s] = [Math.cos(b.a), Math.sin(b.a)]
            return (
              <path
                d={`M${CX + c * b.from} ${CY + s * b.from}L${CX + c * b.to} ${CY + s * b.to}`}
                stroke={b.color}
                strokeWidth={b.width}
                strokeLinecap="round"
                trim={() => [tail(), head()]}
              />
            )
          }}
        </For>
        <Ornaments />
      </svg>

      <CropMarks at={40} color={C.paper} />
      <Label index="01" name="FRAMESCRIPT 2 — MOTION REEL" at={52} color={C.paper} style={{ left: 120, top: 104, opacity: lines }} />
      <text style={{ position: "absolute", right: 120, top: 104, fontFamily: MONO, fontSize: 20, letterSpacing: 3, color: C.paper, opacity: lines }}>
        {() => timecode(global())}
      </text>

      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1920,
          height: 1000,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Rise
          text="MOTION"
          at={10}
          out={316}
          stagger={3}
          length={30}
          size={300}
          room={1.0}
          style={{ fontFamily: DISPLAY, fontWeight: 900, color: C.paper, letterSpacing: -6 }}
          // A wave along the word on the first beat of the second bar, and on the third.
          lift={(i) => hop(frame(), 120 + i * 3) + hop(frame(), 180 + i * 3)}
        />
        <div style={{ marginTop: 6 }}>
          <Rise
            text="GRAPHICS"
            at={26}
            out={320}
            stagger={2}
            length={28}
            size={150}
            room={1.15}
            style={{ fontFamily: DISPLAY, fontWeight: 900, letterSpacing: 18, textStroke: `3px ${C.paper}` }}
            // Filled in one letter after another on the beat.
            letter={(i) => ({ color: () => (frame() >= 150 + i * 4 ? C.yellow : "rgba(0,0,0,0)"), textStroke: () => (frame() >= 150 + i * 4 ? `3px ${C.yellow}` : `3px ${C.paper}`) })}
          />
        </div>
        <div
          style={{
            marginTop: 26,
            height: 10,
            background: C.red,
            width: () => 1180 * span(frame(), 44, 36, outExpo),
            translate: () => [1180 * span(frame(), 312, 26, inCubic) * 0.5, 0],
            scale: () => [1 - span(frame(), 312, 26, inCubic), 1],
          }}
        />
      </div>

      {/* "Made of" and a word a beat, at the bottom. */}
      <div
        style={{
          position: "absolute",
          left: 120,
          bottom: 104,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 18,
          opacity: () => span(frame(), 210, 16) * (1 - span(frame(), 318, 14)),
        }}
      >
        <text style={{ fontFamily: MONO, fontSize: 26, letterSpacing: 4, color: C.paper }}>MADE OF</text>
        <div style={{ background: C.yellow, paddingLeft: 14, paddingRight: 14, scale: () => [1, 1 + 0.08 * thump()] }}>
          <Slot
            words={MADE_OF}
            index={() => rolled(frame(), [240, 240 + BEAT, 240 + BEAT * 2, 240 + BEAT * 3, 240 + BEAT * 4, 240 + BEAT * 5, 240 + BEAT * 6], 10)}
            size={26}
            width={110}
            style={{ fontFamily: MONO, fontWeight: 700, letterSpacing: 4, color: C.ink }}
          />
        </div>
      </div>
      <text
        style={{
          position: "absolute",
          right: 120,
          bottom: 110,
          fontFamily: MONO,
          fontSize: 20,
          letterSpacing: 3,
          color: C.paper,
          opacity: () => span(frame(), 220, 16) * (1 - span(frame(), 318, 14)) * 0.7,
        }}
      >
        1920 × 1080 · 60 FPS · NO BROWSER
      </text>
    </div>
  )
}

/** Up and back down in about half a beat, from `at`. */
function hop(f: number, at: number): number {
  const t = span(f, at, 16)
  return Math.sin(Math.PI * t) * 46
}

function timecode(frame: number): string {
  const s = Math.floor(frame / 60)
  const two = (n: number) => String(n).padStart(2, "0")
  return `${two(Math.floor(s / 60))}:${two(s % 60)}:${two(frame % 60)}`
}

/** Small things around the title, each popping in on a beat and nodding with the kick. */
function Ornaments() {
  const frame = useCurrentFrame()
  const thump = useThump()
  const items = [
    { x: 330, y: 250, at: 60, kind: "ring", color: C.yellow },
    { x: 1590, y: 230, at: 75, kind: "plus", color: C.red },
    { x: 1660, y: 720, at: 90, kind: "zigzag", color: C.blue },
    { x: 260, y: 760, at: 105, kind: "triangle", color: C.red },
    { x: 1460, y: 870, at: 120, kind: "half", color: C.yellow },
    { x: 480, y: 900, at: 135, kind: "square", color: C.blue },
    { x: 1760, y: 470, at: 150, kind: "dots", color: C.paper },
    { x: 160, y: 470, at: 165, kind: "arc", color: C.paper },
  ]
  return (
    <For each={items}>
      {(o, i) => {
        const transform = () => {
          const f = frame()
          const s = outElastic(span(f, o.at, 44)) * (1 - span(f, 312 + i * 2, 18, inCubic)) * (1 + 0.12 * thump())
          const r = f * (i % 2 ? 0.6 : -0.45) + i * 40
          const bob = Math.sin((f + i * 20) / 30) * 8
          return `translate(${o.x} ${o.y + bob}) rotate(${r}) scale(${Math.max(0, s)})`
        }
        return (
          <g transform={transform} fill="none" stroke={o.color} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round">
            {shape(o.kind, o.color)}
          </g>
        )
      }}
    </For>
  )
}

function shape(kind: string, color: string) {
  switch (kind) {
    case "ring":
      return <circle r={38} />
    case "plus":
      return <path d="M-30 0H30M0 -30V30" strokeWidth={9} />
    case "zigzag":
      return <polyline points="-56,10 -34,-12 -12,10 10,-12 32,10 54,-12" />
    case "triangle":
      return <polygon points="0,-36 32,22 -32,22" fill={color} stroke="none" />
    case "half":
      return <path d="M-40 0C-40 -22.1 -22.1 -40 0 -40C22.1 -40 40 -22.1 40 0Z" fill={color} stroke="none" />
    case "square":
      return <rect x={-24} y={-24} width={48} height={48} />
    case "dots":
      return (
        <g fill={color} stroke="none">
          <circle cx={-22} cy={-22} r={6} />
          <circle cx={0} cy={-22} r={6} />
          <circle cx={22} cy={-22} r={6} />
          <circle cx={-22} cy={0} r={6} />
          <circle cx={0} cy={0} r={6} />
          <circle cx={22} cy={0} r={6} />
          <circle cx={-22} cy={22} r={6} />
          <circle cx={0} cy={22} r={6} />
          <circle cx={22} cy={22} r={6} />
        </g>
      )
    default:
      return <path d="M-40 20C-30 -16 30 -16 40 20" />
  }
}
