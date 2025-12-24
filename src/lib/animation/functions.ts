export type Easing = (t: number) => number

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export const easeOutCubic: Easing = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3)
export const easeInOutCubic: Easing = (t) => {
  const x = clamp(t, 0, 1)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}
export const easeOutExpo: Easing = (t) => {
  const x = clamp(t, 0, 1)
  return x === 1 ? 1 : 1 - Math.pow(2, -10 * x)
}

export const frameProgress = (
  frame: number,
  startFrame: number,
  endFrame: number,
  easing: Easing = (t) => t,
) => {
  const denom = Math.max(1, endFrame - startFrame)
  const t = clamp((frame - startFrame) / denom, 0, 1)
  return easing(t)
}

export const fadeInOut = (frame: number, durationFrames: number, opts?: { in?: number; out?: number }) => {
  const total = Math.max(1, durationFrames)
  const fadeIn = Math.max(0, Math.floor(opts?.in ?? Math.min(18, total / 6)))
  const fadeOut = Math.max(0, Math.floor(opts?.out ?? Math.min(18, total / 6)))

  const tIn = fadeIn > 0 ? clamp(frame / fadeIn, 0, 1) : 1
  const tOut = fadeOut > 0 ? clamp((total - 1 - frame) / fadeOut, 0, 1) : 1
  return Math.min(tIn, tOut)
}

export const stagger = (index: number, eachFrames: number, base = 0) =>
  base + index * Math.max(0, eachFrames)

