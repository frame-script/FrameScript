export type FrameScriptDebugLog = {
  at: number
  source: string
  event: string
  data?: unknown
}

const DEBUG_LOG_KEY = "__frameScript_DebugLogs"
const MAX_DEBUG_LOGS = 2000

const getDebugLogs = () => {
  const g = globalThis as unknown as Record<string, unknown>
  const existing = g[DEBUG_LOG_KEY] as FrameScriptDebugLog[] | undefined
  if (existing) return existing
  const logs: FrameScriptDebugLog[] = []
  g[DEBUG_LOG_KEY] = logs
  return logs
}

const isConsoleDebugEnabled = () => {
  if (typeof window === "undefined") return false
  try {
    return (
      window.localStorage.getItem("framescriptDebug") === "1" ||
      window.location.search.includes("framescriptDebug=1")
    )
  } catch {
    return false
  }
}

export const installDebugLogApi = () => {
  if (typeof window === "undefined") return
  ;(window as any).__frameScript = {
    ...(window as any).__frameScript,
    getAnimationDebugLogs: () => [...getDebugLogs()],
    clearAnimationDebugLogs: () => {
      getDebugLogs().length = 0
    },
    enableAnimationDebugLogs: () => {
      try {
        window.localStorage.setItem("framescriptDebug", "1")
      } catch {
        // ignore storage failures
      }
    },
  }
}

export const recordFrameScriptDebugLog = (
  source: string,
  event: string,
  data?: unknown,
) => {
  const logs = getDebugLogs()
  const entry: FrameScriptDebugLog = {
    at:
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now(),
    source,
    event,
    data,
  }
  logs.push(entry)
  if (logs.length > MAX_DEBUG_LOGS) {
    logs.splice(0, logs.length - MAX_DEBUG_LOGS)
  }

  installDebugLogApi()
  if (isConsoleDebugEnabled()) {
    console.log(`[FrameScript:${source}] ${event}`, data ?? "")
  }
}

if (typeof window !== "undefined") {
  installDebugLogApi()
}
