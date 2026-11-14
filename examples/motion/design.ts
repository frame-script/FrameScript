// The look of the whole: colors, type, and the curves things move along.

export const C = {
  ink: "#16141c",
  paper: "#f1ece2",
  red: "#ee4231",
  blue: "#2a5bd7",
  yellow: "#ffc23d",
  mint: "#3ad6a6",
  pink: "#ff8fab",
  /** Lines on paper. */
  rule: "rgba(22, 20, 28, 0.14)",
  /** Lines on ink. */
  ruleDark: "rgba(241, 236, 226, 0.12)",
}

export const DISPLAY = "Noto Sans"
export const MONO = "Noto Sans Mono"
export const JP = "Noto Sans CJK JP"

export const W = 1920
export const H = 1080

export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
export const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** How far into `[start, start + length)` frame `f` is, from 0 to 1, through `ease`. */
export function span(f: number, start: number, length: number, ease: (t: number) => number = (t) => t): number {
  return ease(clamp01((f - start) / length))
}

// Curves. Each takes 0..1 to 0..1 (some going past 1 on the way).
export const inCubic = (t: number) => t * t * t
export const outCubic = (t: number) => 1 - (1 - t) ** 3
export const inOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
export const outQuint = (t: number) => 1 - (1 - t) ** 5
export const inQuint = (t: number) => t ** 5
export const inOutQuint = (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2)
export const outExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t))
export const inExpo = (t: number) => (t <= 0 ? 0 : 2 ** (10 * t - 10))
export const inOutExpo = (t: number) =>
  t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2

/** Past the end and back, by `s` (1.7 is the usual). */
export const outBack = (t: number, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2
export const inBack = (t: number, s = 1.70158) => (s + 1) * t ** 3 - s * t * t

/** A spring let go at 0: past the end and back a few times, settling at 1. */
export function spring(t: number, bounces = 3, damping = 5): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return 1 - Math.exp(-damping * t) * Math.cos(bounces * Math.PI * t) * (1 - t)
}

/** An elastic settle: a pop that rings. */
export const outElastic = (t: number) =>
  t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1

/** A number from 0 to 1 that is always the same for the same `i` and `salt`. */
export function rand(i: number, salt = 0): number {
  let h = (i * 374761393 + salt * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export const px = (n: number) => Math.round(n * 100) / 100

/** Partway from one `#rrggbb` to another, as `rgb(…)`. */
export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => Number.parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  const c = [0, 1, 2].map((i) => Math.round(mix(p(a, i), p(b, i), clamp01(t))))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}
