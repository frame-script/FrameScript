import { useLayoutEffect, useRef, useState, type DependencyList } from "react"
import { useProvideClipDuration } from "./clip"
import { useCurrentFrame } from "./frame"
import type { Easing } from "./animation/functions"

type Lerp<T> = (from: T, to: T, t: number) => T

export type Vec2 = { x: number; y: number }
export type Vec3 = { x: number; y: number; z: number }
export type VariableType = number | Vec2 | Vec3

type VariableKind = "number" | "vec2" | "vec3"

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

export type Variable<T> = {
  use: () => T
  get: (frame: number) => T
  _state: VariableStateBase
}

type MoveController<T> = {
  to: (value: T, durationFrames: number, easing?: Easing) => Promise<void>
}

type AnimationContext = {
  sleep: (frames: number) => Promise<void>
  move: <T extends VariableType>(variable: Variable<T>) => MoveController<T>
}

type InternalContext = AnimationContext & {
  now: number
  maxFrame: number
  register: (variable: Variable<unknown>) => void
}

let nextOwnerId = 1

const toFrames = (value: number) => Math.max(0, Math.round(value))
const isDev = typeof import.meta !== "undefined" && Boolean((import.meta as any).env?.DEV)

const getKind = (value: unknown): VariableKind | null => {
  if (typeof value === "number") return "number"
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

const lerpForKind = (kind: VariableKind): Lerp<VariableType> => {
  switch (kind) {
    case "number":
      return lerpNumber as Lerp<VariableType>
    case "vec2":
      return lerpVec2 as Lerp<VariableType>
    case "vec3":
      return lerpVec3 as Lerp<VariableType>
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

export function useVariable(initial: number): Variable<number>
export function useVariable(initial: Vec2): Variable<Vec2>
export function useVariable(initial: Vec3): Variable<Vec3>
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
      sleep: async (frames: number) => {
        const delta = toFrames(frames)
        internal.now += delta
        internal.maxFrame = Math.max(internal.maxFrame, internal.now)
      },
      move: (variable) => {
        internal.register(variable as Variable<unknown>)
        return {
          to: async (value, durationFrames, easing) => {
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
            internal.now = end + 1
            internal.maxFrame = Math.max(internal.maxFrame, internal.now)
          },
        }
      },
    }

    const execute = async () => {
      try {
        await run(internal)
      } finally {
        // keep owner
      }

      if (runIdRef.current !== runId) {
        return
      }
      const nextDuration = Math.max(1, Math.round(internal.maxFrame))
      setDurationFrames(nextDuration)
      setReady(true)
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
    }
  }, deps)

  return { durationFrames, ready }
}
