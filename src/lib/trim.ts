/**
 * Trim options in frames.
 *
 * フレーム単位のトリム指定。
 *
 * @example
 * ```ts
 * const trim: Trim = { from: 30, duration: 120 }
 * ```
 */
export type Trim =
  | { trimStart: number; trimEnd: number }
  | { from: number; duration: number }

/**
 * Normalized trim values (start/end in frames).
 *
 * 正規化されたトリム情報（開始/終了フレーム）。
 *
 * @example
 * ```ts
 * const t: ResolvedTrim = { trimStartFrames: 0, trimEndFrames: 0 }
 * ```
 */
export type ResolvedTrim = {
  trimStartFrames: number
  trimEndFrames: number
}

const toFrames = (value: number | undefined) =>
  Math.max(
    0,
    Math.floor(Number.isFinite(value as number) ? (value as number) : 0),
  )

/**
 * Resolves trim parameters into start/end frames.
 *
 * トリム指定を開始/終了フレームに変換します。
 *
 * @example
 * ```ts
 * const resolved = resolveTrimFrames({ rawDurationFrames: 300, trim: { from: 30, duration: 120 } })
 * ```
 */
export const resolveTrimFrames = (params: {
  rawDurationFrames: number
  trim?: Trim
}): ResolvedTrim => {
  const rawDurationFrames = Math.max(0, Math.floor(params.rawDurationFrames))

  const trim = params.trim
  if (trim) {
    if ("from" in trim) {
      const from = toFrames(trim.from)
      const duration = toFrames(trim.duration)
      const endExclusive = from + duration
      const trimStartFrames = from
      const trimEndFrames =
        rawDurationFrames > 0
          ? Math.max(0, rawDurationFrames - endExclusive)
          : 0
      return { trimStartFrames, trimEndFrames }
    }

    return {
      trimStartFrames: toFrames(trim.trimStart),
      trimEndFrames: toFrames(trim.trimEnd),
    }
  }

  return { trimStartFrames: 0, trimEndFrames: 0 }
}
