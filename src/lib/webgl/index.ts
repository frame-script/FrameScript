import { useCallback, useEffect, useRef, type DependencyList, type RefObject } from "react"
import { createManualPromise, type ManualPromise } from "../../util/promise"

export type WebGLContextLike = WebGLRenderingContext | WebGL2RenderingContext

type WebGLTracker = {
  pending: number
  start: () => () => void
  wait: () => Promise<void>
}

const WEBGL_TRACKER_KEY = "__frameScript_WebGLTracker"
const waitWebGLFrameCallbacks = new Map<string, (frame: number) => Promise<void>>()

const getWebGLTracker = (): WebGLTracker => {
  const g = globalThis as unknown as Record<string, unknown>
  const existing = g[WEBGL_TRACKER_KEY] as WebGLTracker | undefined
  if (existing) return existing

  let pending = 0
  const waiters = new Set<() => void>()

  const notifyIfReady = () => {
    if (pending !== 0) return
    for (const resolve of Array.from(waiters)) {
      resolve()
    }
    waiters.clear()
  }

  const tracker: WebGLTracker = {
    get pending() {
      return pending
    },
    start: () => {
      pending += 1
      let done = false
      return () => {
        if (done) return
        done = true
        pending = Math.max(0, pending - 1)
        notifyIfReady()
      }
    },
    wait: () => {
      if (pending === 0) {
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => {
        waiters.add(resolve)
      })
    },
  }

  g[WEBGL_TRACKER_KEY] = tracker
  return tracker
}

const waitForAnimationTick = () =>
  new Promise<void>((resolve) => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      setTimeout(resolve, 0)
      return
    }
    window.requestAnimationFrame(() => resolve())
  })

const installWebGLApi = () => {
  if (typeof window === "undefined") return
  const tracker = getWebGLTracker()
  const waitWebGLReady = async () => {
    while (true) {
      if (tracker.pending === 0) {
        await waitForAnimationTick()
        if (tracker.pending === 0) return
      }
      await tracker.wait()
    }
  }

  const waitWebGLFrame = async (frame: number) => {
    if (tracker.pending > 0) {
      await waitWebGLReady()
    }
    const callbacks = Array.from(waitWebGLFrameCallbacks.values())
    if (callbacks.length > 0) {
      await Promise.all(callbacks.map((cb) => cb(frame)))
    }
    if (tracker.pending > 0) {
      await waitWebGLReady()
    }
  }

  ;(window as any).__frameScript = {
    ...(window as any).__frameScript,
    waitWebGLReady,
    waitWebGLFrame,
    getWebGLPending: () => tracker.pending,
  }
}

if (typeof window !== "undefined") {
  installWebGLApi()
}

/**
 * Marks WebGL setup work as pending so render can wait.
 *
 * WebGL の初期化待ちを render 側へ伝えます。
 */
export const useWebGLPending = () => {
  const finishRef = useRef<(() => void) | null>(null)
  const beginPending = useCallback(() => {
    if (!finishRef.current) {
      finishRef.current = getWebGLTracker().start()
    }
  }, [])
  const endPending = useCallback(() => {
    if (finishRef.current) {
      finishRef.current()
      finishRef.current = null
    }
  }, [])

  useEffect(() => () => endPending(), [endPending])

  return { beginPending, endPending }
}

/**
 * Tracks an async task as "WebGL pending" so render waits for it.
 *
 * WebGL の準備完了を待機させるためのラッパーです。
 *
 * @example
 * ```ts
 * await trackWebGLReady(loadTextures())
 * ```
 */
export const trackWebGLReady = async <T,>(promise: Promise<T>): Promise<T> => {
  const finish = getWebGLTracker().start()
  try {
    return await promise
  } finally {
    finish()
  }
}

export type WebGLContextInfo = {
  gl: WebGLContextLike
  isWebGL2: boolean
  canvas: HTMLCanvasElement
}

export type WebGLContextOptions = {
  enabled?: boolean
  preferWebGL2?: boolean
  deps?: DependencyList
  onContextCreated?: (info: WebGLContextInfo) => void
  onContextLost?: () => void
  onContextRestored?: () => void
  onContextFailed?: () => void
}

/**
 * Initializes a WebGL context and reinitializes after context loss.
 *
 * WebGL の生成と context lost 復旧を管理します。
 *
 * @example
 * ```tsx
 * const canvasRef = useRef<HTMLCanvasElement | null>(null)
 * const { glRef } = useWebGLContext(canvasRef, ({ gl }) => {
 *   // create shaders/buffers here
 *   return () => {
 *     // dispose resources here
 *   }
 * })
 * ```
 */
export const useWebGLContext = (
  canvasRef: RefObject<HTMLCanvasElement | null>,
  init: (info: WebGLContextInfo) => void | (() => void) | Promise<void | (() => void)>,
  options?: WebGLContextOptions,
) => {
  const glRef = useRef<WebGLContextLike | null>(null)
  const isWebGL2Ref = useRef(false)
  const cleanupRef = useRef<(() => void) | null>(null)
  const initRef = useRef(init)
  const recoveryRef = useRef<ManualPromise<void> | null>(null)
  const optionsRef = useRef(options)
  const enabled = options?.enabled ?? true
  const preferWebGL2 = options?.preferWebGL2 ?? true
  const deps = options?.deps ?? []

  useEffect(() => {
    initRef.current = init
  }, [init])

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  useEffect(() => {
    if (!enabled) return
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false

    const resolveRecovery = () => {
      if (!recoveryRef.current) return
      recoveryRef.current.resolve()
      recoveryRef.current = null
    }

    const runInit = async () => {
      const gl = preferWebGL2
        ? canvas.getContext("webgl2") ?? canvas.getContext("webgl")
        : canvas.getContext("webgl")

      if (!gl) {
        glRef.current = null
        isWebGL2Ref.current = false
        if (typeof optionsRef.current?.onContextFailed === "function") {
          optionsRef.current.onContextFailed()
        }
        return
      }

      glRef.current = gl
      isWebGL2Ref.current =
        typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext

      const info: WebGLContextInfo = { gl, isWebGL2: isWebGL2Ref.current, canvas }
      if (typeof optionsRef.current?.onContextCreated === "function") {
        optionsRef.current.onContextCreated(info)
      }

      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }

      const cleanup = await initRef.current(info)
      cleanupRef.current = typeof cleanup === "function" ? cleanup : null
    }

    const handleLost = (event: Event) => {
      event.preventDefault()
      if (disposed) return
      if (typeof optionsRef.current?.onContextLost === "function") {
        optionsRef.current.onContextLost()
      }
      if (!recoveryRef.current) {
        recoveryRef.current = createManualPromise()
        void trackWebGLReady(recoveryRef.current.promise)
      }
      glRef.current = null
      isWebGL2Ref.current = false
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }
    }

    const handleRestored = () => {
      if (disposed) return
      if (typeof optionsRef.current?.onContextRestored === "function") {
        optionsRef.current.onContextRestored()
      }
      void trackWebGLReady(
        Promise.resolve(runInit()).finally(() => {
          resolveRecovery()
        }),
      )
    }

    canvas.addEventListener("webglcontextlost", handleLost, false)
    canvas.addEventListener("webglcontextrestored", handleRestored, false)

    void trackWebGLReady(
      Promise.resolve(runInit()).finally(() => {
        resolveRecovery()
      }),
    )

    return () => {
      disposed = true
      canvas.removeEventListener("webglcontextlost", handleLost, false)
      canvas.removeEventListener("webglcontextrestored", handleRestored, false)
      if (cleanupRef.current) {
        cleanupRef.current()
        cleanupRef.current = null
      }
      glRef.current = null
      isWebGL2Ref.current = false
      resolveRecovery()
    }
  }, [canvasRef, enabled, preferWebGL2, ...deps])

  return { glRef, isWebGL2Ref }
}

const waitForWebGL2Finish = async (gl: WebGL2RenderingContext): Promise<boolean> => {
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
  if (!sync) {
    gl.finish()
    return true
  }
  gl.flush()

  const start = typeof performance !== "undefined" ? performance.now() : Date.now()
  const timeoutMs = 5000
  let completed = false
  while (true) {
    const status = gl.clientWaitSync(sync, 0, 0)
    if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
      completed = true
      break
    }
    if (status === gl.WAIT_FAILED) {
      break
    }
    const now = typeof performance !== "undefined" ? performance.now() : Date.now()
    if (now - start > timeoutMs) {
      break
    }
    await waitForAnimationTick()
  }
  gl.deleteSync(sync)
  return completed
}

/**
 * Blocks until GPU commands are finished for the provided context.
 *
 * GPU の完了を待ってから次へ進みます。
 */
export const waitForWebGLFinish = async (gl: WebGLContextLike | null) => {
  if (!gl) return
  try {
    if (typeof gl.isContextLost === "function" && gl.isContextLost()) return
    if ("fenceSync" in gl) {
      const completed = await waitForWebGL2Finish(gl as WebGL2RenderingContext)
      if (completed) return
    }
    gl.finish()
  } catch {
    // ignore sync errors during render
  }
}

/**
 * Registers a per-frame GPU wait so headless rendering avoids incomplete frames.
 *
 * レンダー時に GPU 完了待ちを差し込みます。
 *
 * @example
 * ```tsx
 * const glRef = useRef<WebGLRenderingContext | null>(null)
 * useWebGLFrameWaiter(glRef)
 * ```
 */
export const useWebGLFrameWaiter = (
  contextRef: RefObject<WebGLContextLike | null>,
  opts?: { enabled?: boolean },
) => {
  const enabled = opts?.enabled ?? true
  const idRef = useRef<string | null>(null)
  if (!idRef.current) {
    idRef.current = `webgl-${Math.random().toString(36).slice(2)}`
  }

  useEffect(() => {
    if (!enabled) return
    const id = idRef.current ?? `webgl-${Math.random().toString(36).slice(2)}`
    idRef.current = id
    const waiter = async (_frame: number) => {
      await waitForWebGLFinish(contextRef.current)
    }
    waitWebGLFrameCallbacks.set(id, waiter)
    return () => {
      waitWebGLFrameCallbacks.delete(id)
    }
  }, [contextRef, enabled])
}
