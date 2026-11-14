// What several scenes use: type that comes up out of a mask, words that roll, marks in the corners.
import { For, type StyleProps, useCurrentFrame } from "framescript"
import { C, clamp01, MONO, outQuint, span } from "./design.ts"

/**
 * Letters that come up out of the line they sit on, one after another, from frame `at` of the
 * clip, `stagger` frames apart; and go down into it from `out`, if given.
 */
export function Rise(props: {
  text: string
  at: number
  out?: number
  stagger?: number
  /** Frames each letter takes. */
  length?: number
  size: number
  style?: StyleProps
  /** How much taller than the type the mask is, as a fraction of the size. */
  room?: number
  /** More style for each letter, by its index. */
  letter?: (i: number) => StyleProps
  /** How far up each letter is moved besides, by its index. */
  lift?: (i: number) => number
}) {
  const frame = useCurrentFrame()
  const letters = [...props.text]
  const stagger = props.stagger ?? 3
  const length = props.length ?? 26
  const room = props.room ?? 1.2
  return (
    <div style={{ display: "flex", flexDirection: "row" }}>
      <For each={letters}>
        {(letter, i) => {
          const y = () => {
            const f = frame()
            const up = 1 - span(f, props.at + i * stagger, length, outQuint)
            const down = props.out === undefined ? 0 : span(f, props.out + i * stagger * 0.6, length * 0.7, (t) => t * t * t)
            return (up - down) * props.size * room
          }
          return (
            // The lift moves the mask, so that the letter isn't cut by it.
            <div
              style={{
                overflow: "hidden",
                height: props.size * room,
                display: "flex",
                alignItems: "center",
                translate: () => [0, -(props.lift?.(i) ?? 0)],
              }}
            >
              <text
                style={{
                  fontSize: props.size,
                  lineHeight: 1,
                  whiteSpace: "pre",
                  ...props.style,
                  ...props.letter?.(i),
                  translate: () => [0, y()],
                }}
              >
                {letter}
              </text>
            </div>
          )
        }}
      </For>
    </div>
  )
}

/**
 * One of `words` at a time, the one `index` says, rolling up to the next when it changes: in a
 * mask as tall as one.
 */
export function Slot(props: { words: string[]; index: () => number; size: number; style?: StyleProps; width?: number }) {
  const line = props.size * 1.25
  return (
    <div style={{ overflow: "hidden", height: line, width: props.width }}>
      <div style={{ display: "flex", flexDirection: "column", translate: () => [0, -props.index() * line] }}>
        <For each={props.words}>
          {(word) => (
            <div style={{ height: line, display: "flex", alignItems: "center" }}>
              <text style={{ fontSize: props.size, lineHeight: 1, whiteSpace: "pre", ...props.style }}>{word}</text>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

/** Where a slot that rolls on at frames `steps` is at frame `f`: whole numbers between rolls. */
export function rolled(f: number, steps: number[], length = 12): number {
  let at = 0
  for (const s of steps) at += outQuint(clamp01((f - s) / length))
  return at
}

/** Crop marks in the four corners, as on a print, drawn in from frame `at`. */
export function CropMarks(props: { at: number; color?: string; inset?: number }) {
  const frame = useCurrentFrame()
  const inset = props.inset ?? 56
  const arm = 34
  const color = props.color ?? C.ink
  const corners: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]]
  return (
    <svg viewBox="0 0 1920 1080" style={{ position: "absolute", inset: 0 }} stroke={color} strokeWidth={2} fill="none">
      <For each={corners}>
        {([cx, cy], i) => {
          const x = cx ? 1920 - inset : inset
          const y = cy ? 1080 - inset : inset
          const sx = cx ? -1 : 1
          const sy = cy ? -1 : 1
          const t = () => span(frame(), props.at + i * 4, 24, outQuint)
          return (
            <path
              d={`M${x} ${y + sy * arm}L${x} ${y}L${x + sx * arm} ${y}`}
              trim={() => [0.5 - t() / 2, 0.5 + t() / 2]}
            />
          )
        }}
      </For>
    </svg>
  )
}

/** A small label in type that looks set by hand: a number, a rule and a name. */
export function Label(props: { index: string; name: string; at: number; color?: string; style?: StyleProps }) {
  const frame = useCurrentFrame()
  const t = () => span(frame(), props.at, 30, outQuint)
  const color = props.color ?? C.ink
  return (
    <div style={{ position: "absolute", display: "flex", flexDirection: "row", alignItems: "center", gap: 18, ...props.style }}>
      <text style={{ fontFamily: MONO, fontSize: 20, letterSpacing: 3, color, opacity: t }}>{props.index}</text>
      <div style={{ width: () => t() * 64, height: 2, background: color }} />
      <text style={{ fontFamily: MONO, fontSize: 20, letterSpacing: 5, color, opacity: t, translate: () => [(1 - t()) * -20, 0] }}>
        {props.name}
      </text>
    </div>
  )
}
