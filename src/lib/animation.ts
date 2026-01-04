import { useLayoutEffect, useRef, useState, type DependencyList } from "react"
import { useProvideClipDuration } from "./clip"
import { useCurrentFrame } from "./frame"
import type { Easing } from "./animation/functions"

type Lerp<T> = (from: T, to: T, t: number) => T

/**
 * 2D vector type.
 *
 * 2 次元ベクトル型。
 *
 * @example
 * ```ts
 * const v: Vec2 = { x: 10, y: 20 }
 * ```
 */
export type Vec2 = { x: number; y: number }
/**
 * 3D vector type.
 *
 * 3 次元ベクトル型。
 *
 * @example
 * ```ts
 * const v: Vec3 = { x: 1, y: 2, z: 3 }
 * ```
 */
export type Vec3 = { x: number; y: number; z: number }


export type ColorHex = `#${string}`
/**
 * Supported variable value types for animation.
 *
 * アニメーション変数で使える値の型。
 *
 * @example
 * ```ts
 * const value: VariableType = { x: 0, y: 0 }
 * ```
 */
export type VariableType = number | Vec2 | Vec3 | ColorHex

type VariableKind = "number" | "vec2" | "vec3" | "color"

type Segment<T> = {
  start: number
  end: number
  from: T
  to: T
  easing?: Easing
}

type VariableStateBase = {
  initial: VariableType
  kind: VariableKind
  lerp: Lerp<VariableType>
  segments: Segment<VariableType>[]
  ownerId: number | null
}

/**
 * Animation variable with timeline-aware sampling.
 *
 * タイムラインに応じた値取得ができるアニメーション変数。
 *
 * @example
 * ```tsx
 * const pos = useVariable({ x: 0, y: 0 })
 * const value = pos.use()
 * ```
 */
export type Variable<T> = {
  use: () => T
  get: (frame: number) => T
  _state: VariableStateBase
}

type MoveController<T> = {
  to: (value: T, durationFrames: number, easing?: Easing) => AnimationHandle
}

type AnimationContext = {
  sleep: (frames: number) => AnimationHandle
  waitUntil: (frame: number) => AnimationHandle
  move: <T extends VariableType>(variable: Variable<T>) => MoveController<T>
  parallel: (handles: AnimationHandle[]) => AnimationHandle
}

type InternalContext = AnimationContext & {
  now: number
  maxFrame: number
  register: (variable: Variable<unknown>) => void
}

let nextOwnerId = 1
const ANIMATION_TRACKER_KEY = "__frameScript_AnimationTracker"

type AnimationTracker = {
  pending: number
  start: () => () => void
  wait: () => Promise<void>
}

const getAnimationTracker = (): AnimationTracker => {
  const g = globalThis as unknown as Record<string, unknown>
  const existing = g[ANIMATION_TRACKER_KEY] as AnimationTracker | undefined
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

  const tracker: AnimationTracker = {
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

  g[ANIMATION_TRACKER_KEY] = tracker
  return tracker
}

const installAnimationApi = () => {
  if (typeof window === "undefined") return
  const tracker = getAnimationTracker()
  const waitAnimationsReady = async () => {
    // Wait until pending is zero and stays zero through a tick (handles StrictMode double-effects).
    while (true) {
      if (tracker.pending === 0) {
        if (typeof window.requestAnimationFrame !== "function") {
          return
        }
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
        if (tracker.pending === 0) return
      }
      await tracker.wait()
    }
  }

  ;(window as any).__frameScript = {
    ...(window as any).__frameScript,
    waitAnimationsReady,
    getAnimationsPending: () => tracker.pending,
  }
}

const toFrames = (value: number) => Math.max(0, Math.round(value))
const isDev = typeof import.meta !== "undefined" && Boolean((import.meta as any).env?.DEV)

type ParsedColor = { r: number; g: number; b: number; a: number; hasAlpha: boolean }

const clampChannel = (value: number) => Math.min(255, Math.max(0, value))

const expandShortHex = (hex: string) => hex.split("").map((ch) => ch + ch).join("")

const parseColorHex = (value: string): ParsedColor | null => {
  if (!value.startsWith("#")) return null
  let raw = value.slice(1)
  let hasAlpha = false

  if (raw.length === 3 || raw.length === 4) {
    hasAlpha = raw.length === 4
    raw = expandShortHex(raw)
  }

  if (raw.length === 8) {
    hasAlpha = true
  } else if (raw.length !== 6) {
    return null
  }

  if (!/^[0-9a-fA-F]+$/.test(raw)) return null

  const r = Number.parseInt(raw.slice(0, 2), 16)
  const g = Number.parseInt(raw.slice(2, 4), 16)
  const b = Number.parseInt(raw.slice(4, 6), 16)
  const a = hasAlpha ? Number.parseInt(raw.slice(6, 8), 16) : 255
  return { r, g, b, a, hasAlpha }
}

const formatColorHex = (r: number, g: number, b: number, a: number | null) => {
  const toHex = (value: number) => clampChannel(value).toString(16).padStart(2, "0").toUpperCase()
  return `#${toHex(r)}${toHex(g)}${toHex(b)}${a == null ? "" : toHex(a)}`
}

const getKind = (value: unknown): VariableKind | null => {
  if (typeof value === "number") return "number"
  if (typeof value === "string") {
    if (parseColorHex(value)) return "color"
  }
  if (value && typeof value === "object") {
    const obj = value as Partial<Vec3>
    if (typeof obj.x === "number" && typeof obj.y === "number") {
      if (typeof obj.z === "number") return "vec3"
      return "vec2"
    }
  }
  return null
}

const lerpNumber = (from: number, to: number, t: number) => from + (to - from) * t
const lerpVec2 = (from: Vec2, to: Vec2, t: number) => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
})
const lerpVec3 = (from: Vec3, to: Vec3, t: number) => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
  z: from.z + (to.z - from.z) * t,
})
const lerpColor = (from: ColorHex, to: ColorHex, t: number) => {
  const fromColor = parseColorHex(from)
  const toColor = parseColorHex(to)
  if (!fromColor || !toColor) {
    return to
  }
  const mix = (a: number, b: number) => a + (b - a) * t
  const r = clampChannel(Math.round(mix(fromColor.r, toColor.r)))
  const g = clampChannel(Math.round(mix(fromColor.g, toColor.g)))
  const b = clampChannel(Math.round(mix(fromColor.b, toColor.b)))
  const a = clampChannel(Math.round(mix(fromColor.a, toColor.a)))
  const useAlpha = fromColor.hasAlpha || toColor.hasAlpha
  return formatColorHex(r, g, b, useAlpha ? a : null)
}

const lerpForKind = (kind: VariableKind): Lerp<VariableType> => {
  switch (kind) {
    case "number":
      return lerpNumber as Lerp<VariableType>
    case "vec2":
      return lerpVec2 as Lerp<VariableType>
    case "vec3":
      return lerpVec3 as Lerp<VariableType>
    case "color":
      return lerpColor as Lerp<VariableType>
  }
}

const assertCompatibleValue = (kind: VariableKind, value: unknown) => {
  const nextKind = getKind(value)
  if (nextKind !== kind) {
    throw new Error(
      `useAnimation: value shape mismatch (expected ${kind}, got ${nextKind ?? "unknown"})`,
    )
  }
}

const sampleSegment = (segment: Segment<VariableType>, frame: number, lerp: Lerp<VariableType>) => {
  const duration = Math.max(1, segment.end - segment.start + 1)
  if (duration <= 1) {
    return segment.to
  }
  const t = Math.min(1, Math.max(0, (frame - segment.start) / (duration - 1)))
  const eased = segment.easing ? segment.easing(t) : t
  return lerp(segment.from, segment.to, eased)
}

const sampleVariable = (state: VariableStateBase, frame: number) => {
  let value = state.initial
  for (const segment of state.segments) {
    if (frame < segment.start) {
      return value
    }
    if (frame <= segment.end) {
      return sampleSegment(segment, frame, state.lerp)
    }
    value = segment.to
  }
  return value
}

/**
 * Thenable handle returned by animation commands.
 *
 * アニメーション操作が返す thenable ハンドル。
 *
 * @example
 * ```tsx
 * const handle = ctx.move(position).to({ x: 100, y: 0 }, seconds(1))
 * await handle
 * ```
 */
export class AnimationHandle {
  private resolved = false
  public readonly endFrame: number
  private ctx: InternalContext

  constructor(ctx: InternalContext, endFrame: number) {
    this.ctx = ctx
    this.endFrame = endFrame
  }

  then(resolve: () => void, _reject?: (reason?: unknown) => void) {
    if (!this.resolved) {
      this.resolved = true
      if (this.ctx.now < this.endFrame) {
        this.ctx.now = this.endFrame
      }
      this.ctx.maxFrame = Math.max(this.ctx.maxFrame, this.ctx.now)
    }
    resolve()
    return undefined
  }
}

/**
 * Creates an animatable variable.
 *
 * アニメーション可能な変数を作成します。
 *
 * @example
 * ```tsx
 * const opacity = useVariable(0)
 * const pos = useVariable({ x: 0, y: 0 })
 * ```
 */
export function useVariable(initial: number): Variable<number>
export function useVariable(initial: Vec2): Variable<Vec2>
export function useVariable(initial: Vec3): Variable<Vec3>
export function useVariable(initial: ColorHex): Variable<ColorHex>
export function useVariable<T extends VariableType>(initial: T): Variable<T> {
  const stateRef = useRef<VariableStateBase | null>(null)
  if (!stateRef.current) {
    const kind = getKind(initial)
    if (!kind) {
      throw new Error("useVariable: unsupported value shape")
    }
    stateRef.current = {
      initial,
      kind,
      lerp: lerpForKind(kind),
      segments: [],
      ownerId: null,
    }
  }

  if (isDev) {
    const nextKind = getKind(initial)
    if (nextKind && nextKind !== stateRef.current.kind) {
      throw new Error(
        `useVariable: value shape changed (was ${stateRef.current.kind}, now ${nextKind})`,
      )
    }
  }

  const state = stateRef.current!
  state.initial = initial as VariableType

  const get = (frame: number) => sampleVariable(state, frame) as T

  const useValue = () => {
    const frame = useCurrentFrame()
    return get(frame)
  }

  return { use: useValue, get, _state: state }
}

/**
 * Defines an animation sequence and reports its duration to the current clip.
 *
 * アニメーションシーケンスを定義し、クリップへ長さを報告します。
 *
 * @example
 * ```tsx
 * useAnimation(async (ctx) => {
 *   await ctx.sleep(seconds(0.5))
 *   await ctx.move(pos).to({ x: 200, y: 0 }, seconds(1))
 * }, [])
 * ```
 */
export const useAnimation = (
  run: (ctx: AnimationContext) => Promise<void> | void,
  deps: DependencyList = [run],
) => {
  const [durationFrames, setDurationFrames] = useState(1)
  const [ready, setReady] = useState(false)
  const runIdRef = useRef(0)
  const ownerIdRef = useRef(0)
  const variablesRef = useRef<Set<Variable<unknown>>>(new Set())

  useProvideClipDuration(durationFrames)

  useLayoutEffect(() => {
    installAnimationApi()
    const tracker = getAnimationTracker()
    const finishPending = tracker.start()
    let finished = false
    const finalize = () => {
      if (finished) return
      finished = true
      finishPending()
    }

    if (!ownerIdRef.current) {
      ownerIdRef.current = nextOwnerId
      nextOwnerId += 1
    }
    const ownerId = ownerIdRef.current
    const runId = runIdRef.current + 1
    runIdRef.current = runId

    for (const variable of variablesRef.current) {
      if (variable._state.ownerId === ownerId) {
        variable._state.segments.length = 0
      }
    }
    variablesRef.current.clear()
    setDurationFrames(1)
    setReady(false)

    const internal: InternalContext = {
      now: 0,
      maxFrame: 0,
      register: (variable) => {
        if (variable._state.ownerId != null && variable._state.ownerId !== ownerId) {
          throw new Error("useAnimation: a variable cannot be shared across multiple animations")
        }
        variable._state.ownerId = ownerId
        variablesRef.current.add(variable)
      },
      sleep: (frames: number) => {
        const delta = toFrames(frames)
        const end = internal.now + delta
        return new AnimationHandle(internal, end)
      },
      waitUntil: (frame: number) => {
        const target = Math.max(internal.now, toFrames(frame))
        return new AnimationHandle(internal, target)
      },
      move: (variable) => {
        internal.register(variable as Variable<unknown>)
        return {
          to: (value, durationFrames, easing) => {
            if (isDev) {
              assertCompatibleValue(variable._state.kind, value)
            }
            const duration = Math.max(1, toFrames(durationFrames))
            const start = internal.now
            const end = start + duration - 1
            const state = variable._state
            const from = sampleVariable(state, start) as VariableType
            state.segments.push({
              start,
              end,
              from,
              to: value as VariableType,
              easing,
            })
            return new AnimationHandle(internal, end + 1)
          },
        }
      },
      parallel: (handles: AnimationHandle[]) => {
        let maxEnd = internal.now
        for (const handle of handles) {
          if (handle instanceof AnimationHandle) {
            maxEnd = Math.max(maxEnd, handle.endFrame)
          }
        }
        return new AnimationHandle(internal, maxEnd)
      },
    }

    const execute = async () => {
      try {
        await run(internal)
      } finally {
        // keep owner
      }

      if (runIdRef.current !== runId) {
        finalize()
        return
      }
      const nextDuration = Math.max(1, Math.round(internal.maxFrame))
      setDurationFrames(nextDuration)
      setReady(true)
      finalize()
    }

    void execute()

    return () => {
      runIdRef.current += 1
      for (const variable of variablesRef.current) {
        if (variable._state.ownerId === ownerId) {
          variable._state.ownerId = null
          variable._state.segments.length = 0
        }
      }
      finalize()
    }
  }, deps)

  return { durationFrames, ready }
}
