/**
 * Easing function type (0..1 -> 0..1).
 *
 * イージング関数の型 (0..1 -> 0..1)。
 *
 * @example
 * ```ts
 * const ease: Easing = (t) => t * t
 * ```
 */
export type Easing = (t: number) => number

/**
 * Clamps a value to the given range.
 *
 * 値を指定した範囲に収めます。
 *
 * @example
 * ```ts
 * const v = clamp(1.2, 0, 1)
 * ```
 */
export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

/**
 * Linear interpolation between two numbers.
 *
 * 2 つの数値を線形補間します。
 *
 * @example
 * ```ts
 * const v = lerp(0, 10, 0.5)
 * ```
 */
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * Creates a cubic-bezier easing function.
 *
 * cubic-bezier のイージング関数を生成します。
 *
 * @example
 * ```ts
 * const ease = cubicBezier(0.42, 0, 0.58, 1)
 * ```
 */
export const cubicBezier = (x1: number, y1: number, x2: number, y2: number): Easing => {
  if (x1 === y1 && x2 === y2) {
    return (t) => clamp(t, 0, 1)
  }

  const NEWTON_ITERATIONS = 4
  const NEWTON_MIN_SLOPE = 0.001
  const SUBDIVISION_PRECISION = 1e-7
  const SUBDIVISION_MAX_ITERATIONS = 10
  const SPLINE_TABLE_SIZE = 11
  const SAMPLE_STEP_SIZE = 1 / (SPLINE_TABLE_SIZE - 1)

  const a = (a1: number, a2: number) => 1 - 3 * a2 + 3 * a1
  const b = (a1: number, a2: number) => 3 * a2 - 6 * a1
  const c = (a1: number) => 3 * a1

  const calcBezier = (t: number, a1: number, a2: number) =>
    ((a(a1, a2) * t + b(a1, a2)) * t + c(a1)) * t
  const getSlope = (t: number, a1: number, a2: number) =>
    3 * a(a1, a2) * t * t + 2 * b(a1, a2) * t + c(a1)

  const sampleValues = new Array<number>(SPLINE_TABLE_SIZE)
  for (let i = 0; i < SPLINE_TABLE_SIZE; i += 1) {
    sampleValues[i] = calcBezier(i * SAMPLE_STEP_SIZE, x1, x2)
  }

  const getTForX = (x: number) => {
    let intervalStart = 0
    let currentSample = 1
    const lastSample = SPLINE_TABLE_SIZE - 1

    for (; currentSample !== lastSample && sampleValues[currentSample] <= x; currentSample += 1) {
      intervalStart += SAMPLE_STEP_SIZE
    }
    currentSample -= 1

    const dist = (x - sampleValues[currentSample]) /
      (sampleValues[currentSample + 1] - sampleValues[currentSample])
    let guessForT = intervalStart + dist * SAMPLE_STEP_SIZE

    const slope = getSlope(guessForT, x1, x2)
    if (slope >= NEWTON_MIN_SLOPE) {
      for (let i = 0; i < NEWTON_ITERATIONS; i += 1) {
        const currentSlope = getSlope(guessForT, x1, x2)
        if (currentSlope === 0) {
          return guessForT
        }
        const currentX = calcBezier(guessForT, x1, x2) - x
        guessForT -= currentX / currentSlope
      }
      return guessForT
    }

    if (slope === 0) {
      return guessForT
    }

    let a1 = intervalStart
    let a2 = intervalStart + SAMPLE_STEP_SIZE
    let t = guessForT
    for (let i = 0; i < SUBDIVISION_MAX_ITERATIONS; i += 1) {
      const currentX = calcBezier(t, x1, x2) - x
      if (Math.abs(currentX) < SUBDIVISION_PRECISION) {
        return t
      }
      if (currentX > 0) {
        a2 = t
      } else {
        a1 = t
      }
      t = (a1 + a2) / 2
    }
    return t
  }

  return (t) => {
    const x = clamp(t, 0, 1)
    const solved = getTForX(x)
    return calcBezier(solved, y1, y2)
  }
}

/**
 * Linear easing (constant speed, no acceleration).
 *
 * 等速のイージング（加減速なし）。
 *
 * @example
 * ```ts
 * const ease = easeLinear
 * ```
 */
export const easeLinear: Easing = (t) => clamp(t, 0, 1)

/**
 * Preset cubic-bezier easing for linear motion.
 *
 * 等速向けのプリセット（加減速なし）。
 *
 * @example
 * ```ts
 * const ease = BEZIER_LINEAR
 * ```
 */
export const BEZIER_LINEAR = cubicBezier(0, 0, 1, 1)

/**
 * Preset cubic-bezier easing (CSS "ease").
 *
 * 既定の cubic-bezier（CSS の "ease"）。
 *
 * @example
 * ```ts
 * const ease = BEZIER_EASE
 * ```
 */
export const BEZIER_EASE = cubicBezier(0.25, 0.1, 0.25, 1)
/**
 * Preset cubic-bezier easing for ease-in.
 *
 * ease-in 用のプリセット。
 *
 * @example
 * ```ts
 * const ease = BEZIER_EASE_IN
 * ```
 */
export const BEZIER_EASE_IN = cubicBezier(0.42, 0, 1, 1)
/**
 * Preset cubic-bezier easing for ease-out.
 *
 * ease-out 用のプリセット。
 *
 * @example
 * ```ts
 * const ease = BEZIER_EASE_OUT
 * ```
 */
export const BEZIER_EASE_OUT = cubicBezier(0, 0, 0.58, 1)
/**
 * Preset cubic-bezier easing for ease-in-out.
 *
 * ease-in-out 用のプリセット。
 *
 * @example
 * ```ts
 * const ease = BEZIER_EASE_IN_OUT
 * ```
 */
export const BEZIER_EASE_IN_OUT = cubicBezier(0.42, 0, 0.58, 1)
/**
 * Preset cubic-bezier easing for smooth motion.
 *
 * なめらかな動き向けのプリセット。
 *
 * @example
 * ```ts
 * const ease = BEZIER_SMOOTH
 * ```
 */
export const BEZIER_SMOOTH = cubicBezier(0.4, 0, 0.2, 1)
/**
 * Preset cubic-bezier easing for sharper motion.
 *
 * 切れ味のある動き向けのプリセット。
 *
 * @example
 * ```ts
 * const ease = BEZIER_SHARP
 * ```
 */
export const BEZIER_SHARP = cubicBezier(0.4, 0, 0.6, 1)
/**
 * Preset cubic-bezier easing for acceleration.
 *
 * 加速を強めるプリセット。
 *
 * @example
 * ```ts
 * const ease = BEZIER_ACCELERATE
 * ```
 */
export const BEZIER_ACCELERATE = cubicBezier(0.4, 0, 1, 1)
/**
 * Preset cubic-bezier easing for deceleration.
 *
 * 減速を強めるプリセット。
 *
 * @example
 * ```ts
 * const ease = BEZIER_DECELERATE
 * ```
 */
export const BEZIER_DECELERATE = cubicBezier(0, 0, 0.2, 1)
/**
 * Preset cubic-bezier easing for snappy motion.
 *
 * 俊敏な動き向けのプリセット。
 *
 * @example
 * ```ts
 * const ease = BEZIER_SNAPPY
 * ```
 */
export const BEZIER_SNAPPY = cubicBezier(0.2, 0.9, 0.2, 1)
/**
 * Preset cubic-bezier easing with overshoot.
 *
 * オーバーシュート向けのプリセット。
 *
 * @example
 * ```ts
 * const ease = BEZIER_OVERSHOOT
 * ```
 */
export const BEZIER_OVERSHOOT = cubicBezier(0.16, 1.25, 0.3, 1)
/**
 * Soft overshoot cubic-bezier preset.
 *
 * 柔らかいオーバーシュートのプリセット。
 *
 * @example
 * ```ts
 * const ease = BEZIER_OVERSHOOT_SOFT
 * ```
 */
export const BEZIER_OVERSHOOT_SOFT = cubicBezier(0.12, 1.1, 0.3, 1)
/**
 * Hard overshoot cubic-bezier preset.
 *
 * 強めのオーバーシュートのプリセット。
 *
 * @example
 * ```ts
 * const ease = BEZIER_OVERSHOOT_HARD
 * ```
 */
export const BEZIER_OVERSHOOT_HARD = cubicBezier(0.18, 1.35, 0.2, 1)

/**
 * Ease-out cubic easing.
 *
 * cubic の ease-out。
 *
 * @example
 * ```ts
 * const ease = easeOutCubic
 * ```
 */
export const easeOutCubic: Easing = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3)
/**
 * Ease-in-out cubic easing.
 *
 * cubic の ease-in-out。
 *
 * @example
 * ```ts
 * const ease = easeInOutCubic
 * ```
 */
export const easeInOutCubic: Easing = (t) => {
  const x = clamp(t, 0, 1)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}
/**
 * Ease-out exponential easing.
 *
 * 指数関数の ease-out。
 *
 * @example
 * ```ts
 * const ease = easeOutExpo
 * ```
 */
export const easeOutExpo: Easing = (t) => {
  const x = clamp(t, 0, 1)
  return x === 1 ? 1 : 1 - Math.pow(2, -10 * x)
}

/**
 * Normalized progress between start/end frames.
 *
 * 開始/終了フレームから 0..1 の進捗を返します。
 *
 * @example
 * ```ts
 * const t = frameProgress(frame, 0, 60, easeOutCubic)
 * ```
 */
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

/**
 * Convenience fade curve with optional in/out lengths.
 *
 * フェードイン/アウトの簡易カーブを返します。
 *
 * @example
 * ```ts
 * const opacity = fadeInOut(frame, durationFrames)
 * ```
 */
export const fadeInOut = (frame: number, durationFrames: number, opts?: { in?: number; out?: number }) => {
  const total = Math.max(1, durationFrames)
  const fadeIn = Math.max(0, Math.floor(opts?.in ?? Math.min(18, total / 6)))
  const fadeOut = Math.max(0, Math.floor(opts?.out ?? Math.min(18, total / 6)))

  const tIn = fadeIn > 0 ? clamp(frame / fadeIn, 0, 1) : 1
  const tOut = fadeOut > 0 ? clamp((total - 1 - frame) / fadeOut, 0, 1) : 1
  return Math.min(tIn, tOut)
}

/**
 * Returns a staggered start frame offset.
 *
 * スタガーの開始フレームを返します。
 *
 * @example
 * ```ts
 * const start = stagger(index, seconds(0.1))
 * ```
 */
export const stagger = (index: number, eachFrames: number, base = 0) =>
  base + index * Math.max(0, eachFrames)
