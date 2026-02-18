type PerfDebugConfig = {
  enabled: boolean
  thresholdMs: number
  cooldownMs: number
}

type PerfDebugState = {
  lastLogAt: Record<string, number>
}

const CONFIG_KEY = "__frameScriptPerfDebug"
const STATE_KEY = "__frameScriptPerfDebugState"

const getConfig = (): PerfDebugConfig => {
  const g = globalThis as unknown as Record<string, unknown>
  const existing = g[CONFIG_KEY] as PerfDebugConfig | undefined
  if (existing) return existing
  const created: PerfDebugConfig = {
    enabled: false,
    thresholdMs: 10,
    cooldownMs: 400,
  }
  g[CONFIG_KEY] = created
  return created
}

const getState = (): PerfDebugState => {
  const g = globalThis as unknown as Record<string, unknown>
  const existing = g[STATE_KEY] as PerfDebugState | undefined
  if (existing) return existing
  const created: PerfDebugState = {
    lastLogAt: {},
  }
  g[STATE_KEY] = created
  return created
}

const nowMs = () =>
  typeof performance !== "undefined" ? performance.now() : Date.now()

/**
 * Logs a performance spike when it exceeds the configured threshold.
 *
 * 設定したしきい値を超えたときのみパフォーマンススパイクをログ出力します。
 *
 * You can tweak behavior at runtime:
 * `window.__frameScriptPerfDebug = { enabled: true, thresholdMs: 8, cooldownMs: 200 }`
 */
export const logPerfSpike = (
  label: string,
  durationMs: number,
  details?: Record<string, unknown>,
) => {
  if (!Number.isFinite(durationMs)) return
  const config = getConfig()
  if (!config.enabled) return
  if (durationMs < config.thresholdMs) return

  const state = getState()
  const now = nowMs()
  const lastAt = state.lastLogAt[label] ?? -Infinity
  if (now - lastAt < config.cooldownMs) return
  state.lastLogAt[label] = now

  console.warn(
    `[perf-spike] ${label} ${durationMs.toFixed(2)}ms`,
    details ?? {},
  )
}

export const isPerfDebugEnabled = () => getConfig().enabled
