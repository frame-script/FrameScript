// What every scene shares: type, the finish of the picture, and the caption in the corner.
import { BEZIER_SMOOTH, BEZIER_SNAPPY, For, seconds, useAnimation, useVariable } from "framescript"
import { bloom, type Effect } from "framescript/3d"
import grade from "./shaders/grade.wgsl"

export const SANS = "Noto Sans"
export const MONO = "Noto Sans Mono"
export const FULL = { width: "100%", height: "100%" } as const

/** Bloom, then the lens, the vignette and the grain. */
export function finish(options: { bloom?: number; threshold?: number } = {}): Effect[] {
  return [
    bloom({ strength: options.bloom ?? 0.9, threshold: options.threshold ?? 0.75, radius: 0.6 }),
    { wgsl: grade, uniforms: { aberration: 0.02, vignette: 0.55, grain: 0.12 } },
  ]
}

/**
 * The number and name of a scene, top left, and what it shows, bottom left: they come in at
 * `from` (frames into the clip) and go at `to`.
 */
export function Caption(props: { index: string; label: string; title: string; body: string; from: number; to: number }) {
  const rule = useVariable(0)
  const head = useVariable(0)
  const title = useVariable(0)
  const body = useVariable(0)
  useAnimation(async (ctx) => {
    await ctx.waitUntil(props.from)
    await ctx.parallel([
      ctx.move(rule).to(1, seconds(0.6), BEZIER_SNAPPY),
      ctx.move(head).to(1, seconds(0.5), BEZIER_SMOOTH),
    ])
    await ctx.move(title).to(1, seconds(0.7), BEZIER_SNAPPY)
    await ctx.move(body).to(1, seconds(0.6), BEZIER_SMOOTH)
    await ctx.waitUntil(props.to - seconds(0.5))
    await ctx.parallel([
      ctx.move(rule).to(0, seconds(0.45), BEZIER_SMOOTH),
      ctx.move(head).to(0, seconds(0.4), BEZIER_SMOOTH),
      ctx.move(title).to(0, seconds(0.4), BEZIER_SMOOTH),
      ctx.move(body).to(0, seconds(0.35), BEZIER_SMOOTH),
    ])
  })
  return (
    <>
      {/* A soft shadow for the words to stand on. */}
      <div
        style={{
          position: "absolute",
          left: -200,
          bottom: -200,
          width: 1400,
          height: 560,
          borderRadius: 400,
          background: "#000000",
          opacity: () => title() * 0.5,
          filter: "blur(80px)",
        }}
      />
      <div style={{ position: "absolute", left: 96, top: 80, display: "flex", flexDirection: "row", alignItems: "center", gap: 20, opacity: head }}>
        <text style={{ fontFamily: MONO, fontSize: 22, color: "#7dd3fc", letterSpacing: 4 }}>{props.index}</text>
        <div style={{ width: () => rule() * 120, height: 2, background: "#7dd3fc" }} />
        <text style={{ fontFamily: MONO, fontSize: 22, color: "#e2e8f0", letterSpacing: 6 }}>{props.label}</text>
      </div>
      <div style={{ position: "absolute", left: 96, bottom: 96, display: "flex", flexDirection: "column", gap: 14 }}>
        <Rise text={props.title} progress={title} style={{ fontFamily: SANS, fontSize: 64, fontWeight: "bold", color: "#f8fafc" }} />
        <text
          style={{
            fontFamily: SANS,
            fontSize: 28,
            color: "#cbd5e1",
            opacity: body,
            translate: () => [0, (1 - body()) * 16],
          }}
        >
          {props.body}
        </text>
      </div>
    </>
  )
}

/**
 * Text whose letters come up one after another, out of a blur, as `progress` goes from 0 to 1 (and
 * go back the same way).
 */
export function Rise(props: { text: string; progress: () => number; style: Record<string, unknown>; spread?: number }) {
  const letters = [...props.text]
  const spread = props.spread ?? 0.5
  const each = (i: number) => () => {
    const start = (i / Math.max(1, letters.length - 1)) * spread
    return Math.min(1, Math.max(0, (props.progress() - start) / (1 - spread)))
  }
  return (
    <div style={{ display: "flex", flexDirection: "row" }}>
      <For each={letters}>
        {(letter, i) => {
          const t = each(i)
          return (
            <text
              style={{
                ...props.style,
                whiteSpace: "pre",
                opacity: t,
                translate: () => [0, (1 - t()) * 40],
                filter: () => `blur(${((1 - t()) * 12).toFixed(2)}px)`,
              }}
            >
              {letter}
            </text>
          )
        }}
      </For>
    </div>
  )
}
