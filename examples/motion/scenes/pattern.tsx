// Pattern: a floor of tiles with two arcs each, turning in waves into new mazes while the drums are
// out; then squares in squares that twist faster and faster into the drop, counting down.
import { For, useCurrentFrame } from "framescript"
import { BEAT } from "../beat.ts"
import { C, DISPLAY, inBack, inCubic, inExpo, inOutCubic, MONO, mixHex, outBack, outExpo, outQuint, rand, span } from "../design.ts"
import { CropMarks, Label } from "../parts.tsx"

const TILE = 120
const COLS = 16
const ROWS = 9
const K = 0.5523 * (TILE / 2)
const H = TILE / 2
/** Two quarter circles about opposite corners of a tile, as cubics. */
const ARCS = `M0 ${-H}C0 ${-H + K} ${-H + K} 0 ${-H} 0M0 ${H}C0 ${H - K} ${H - K} 0 ${H} 0`

/** The waves that turn tiles: when, which way they go across, and which tiles they take. */
const WAVES = Array.from({ length: 7 }, (_, k) => ({ at: 24 + k * BEAT, kind: k % 3 }))

const TILES = Array.from({ length: COLS * ROWS }, (_, i) => {
  const [col, row] = [i % COLS, Math.floor(i / COLS)]
  const [x, y] = [col * TILE + H, row * TILE + H]
  const across = (col + row) / (COLS + ROWS - 2)
  const stops = [C.red, C.yellow, C.mint, C.blue]
  const at = across * (stops.length - 1)
  const j = Math.min(stops.length - 2, Math.floor(at))
  return {
    i,
    x,
    y,
    color: mixHex(stops[j], stops[j + 1], at - j),
    turn: rand(i, 3) < 0.5 ? 0 : 90,
    middle: Math.hypot(x - 960, y - 540),
    col,
    row,
  }
})

/** How long after a wave starts it gets to a tile. */
function delay(kind: number, t: (typeof TILES)[number]): number {
  if (kind === 0) return (t.col + t.row) * 1.6
  if (kind === 1) return t.middle / 34
  return (COLS - t.col) * 2
}

export function PatternScene() {
  const frame = useCurrentFrame()
  const text = () => span(frame(), 20, 20) * (1 - span(frame(), 200, 20))
  return (
    <div style={{ position: "absolute", inset: 0, background: C.ink }}>
      <svg viewBox="0 0 1920 1080" style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080 }} fill="none" strokeWidth={10} strokeLinecap="round">
        <For each={TILES}>{(t) => <Tile tile={t} />}</For>
      </svg>
      <Tunnel />
      <CropMarks at={10} color={C.paper} />
      <div style={{ position: "absolute", left: 104, top: 84, background: C.ink, paddingLeft: 16, paddingRight: 16, paddingTop: 10, paddingBottom: 10, width: 300, height: 44, opacity: text }}>
        <Label index="04" name="PATTERN" at={20} color={C.paper} style={{ left: 16, top: 20 }} />
      </div>
      <text
        style={{
          position: "absolute",
          right: 104,
          top: 94,
          background: C.ink,
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 10,
          paddingBottom: 10,
          fontFamily: MONO,
          fontSize: 20,
          letterSpacing: 3,
          color: C.paper,
          opacity: text,
        }}
      >
        144 TILES · TWO ARCS EACH
      </text>
    </div>
  )
}

function Tile(props: { tile: (typeof TILES)[number] }) {
  const frame = useCurrentFrame()
  const t = props.tile
  const drawn = () => span(frame(), t.middle / 28, 34, inOutCubic)
  const transform = () => {
    const f = frame()
    let turn = t.turn
    for (const [k, w] of WAVES.entries()) {
      if (rand(t.i, 40 + k) < 0.5) turn += 90 * outBack(span(f, w.at + delay(w.kind, t), 18), 1.8)
    }
    const gone = span(f, 196 + (900 - t.middle) / 40, 22, (x) => inBack(x, 2))
    return `translate(${t.x} ${t.y}) rotate(${turn}) scale(${Math.max(0, 1 - gone)})`
  }
  return <path d={ARCS} transform={transform} stroke={t.color} trim={() => [0, drawn()]} />
}

const SQUARES = Array.from({ length: 22 }, (_, i) => ({
  i,
  half: 760 * 0.86 ** i,
  color: [C.red, C.yellow, C.blue, C.paper][i % 4],
}))

/** When the squares turn: a beat apart, then half, then a quarter, up to the drop. */
const TWISTS = [
  ...Array.from({ length: 4 }, (_, k) => 250 + k * BEAT),
  ...Array.from({ length: 4 }, (_, k) => 370 + k * (BEAT / 2)),
  ...Array.from({ length: 8 }, (_, k) => 430 + k * (BEAT / 4)),
]

function Tunnel() {
  const frame = useCurrentFrame()
  const zoom = () => 1 + 7 * span(frame(), 446, 34, inExpo)
  return (
    <>
      <svg viewBox="0 0 1920 1080" style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080 }} fill="none">
        <For each={SQUARES}>
          {(s) => {
            const transform = () => {
              const f = frame()
              let turn = 0
              for (const at of TWISTS) turn += 90 * inOutCubic(span(f, at + s.i * 1.5, 16))
              const grow = outBack(span(f, 214 + (21 - s.i) * 1.5, 26), 1.6)
              return `translate(960 540) rotate(${turn + s.i * 4}) scale(${grow * zoom()})`
            }
            return (
              <rect
                x={-s.half}
                y={-s.half}
                width={s.half * 2}
                height={s.half * 2}
                rx={s.half * 0.12}
                transform={transform}
                stroke={s.color}
                strokeWidth={Math.max(3, 16 * 0.9 ** s.i)}
              />
            )
          }}
        </For>
      </svg>
      {/* Four, three, two, one, in the middle. */}
      <For each={[0, 1, 2, 3]}>
        {(k) => {
          const at = 360 + k * BEAT
          const t = () => span(frame(), at, BEAT)
          return (
            <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <text
                style={{
                  fontFamily: DISPLAY,
                  fontWeight: 900,
                  fontSize: 300,
                  lineHeight: 1,
                  color: k % 2 ? C.yellow : C.paper,
                  opacity: () => (frame() >= at && frame() < at + BEAT ? 1 - inCubic(t()) : 0),
                  scale: () => 1.5 - 0.5 * outExpo(t()),
                  textStroke: `6px ${C.ink}`,
                  paintOrder: "stroke",
                }}
              >
                {String(4 - k)}
              </text>
            </div>
          )
        }}
      </For>
    </>
  )
}
