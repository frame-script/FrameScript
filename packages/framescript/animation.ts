/**
 * Animations written as scripts over time.
 *
 * ```tsx
 * const position = useVariable({ x: -300, y: 0 })
 * const opacity = useVariable(0)
 *
 * useAnimation(async (ctx) => {
 *   await ctx.parallel([
 *     ctx.move(position).to({ x: 240, y: 0 }, seconds(1.2), BEZIER_SMOOTH),
 *     ctx.move(opacity).to(1, seconds(0.6)),
 *   ])
 *   await ctx.sleep(seconds(0.5))
 *   await ctx.move(opacity).to(0, seconds(0.3))
 * })
 *
 * <div style={{ opacity, translate: () => [position().x, position().y] }} />
 * ```
 *
 * The script runs once, when the component is made, and doesn't wait for anything: awaiting a
 * handle only moves the script's own clock to where the handle ends. What comes out is a list of
 * segments per variable, and the value of a variable at a frame is a pure function of the frame.
 * Seeking anywhere costs a binary search per variable, and a variable that isn't moving at the
 * frame doesn't change, so nothing that reads it runs.
 *
 * スクリプトは作られたときに一度だけ（同期的に）走り、変数ごとのセグメント列になる。
 * 任意のフレームの値はフレームだけで決まる純粋関数。
 */

import { type ColorHex, mixColor, parseColor } from "./color.ts"
import type { Easing } from "./easing.ts"
import { type Accessor, createMemo, untrack } from "./reactive.ts"
import { useClip, useCurrentFrame } from "./frame.ts"
import { findClip, needAtRoot } from "./timeline.ts"
import { runMicrotasks } from "./internal/ops.ts"

export type Vec2 = { x: number; y: number }
export type Vec3 = { x: number; y: number; z: number }
export type { ColorHex }
export type VariableType = number | Vec2 | Vec3 | ColorHex

type Kind = "number" | "vec2" | "vec3" | "color"

interface Segment<T> {
  /** The first frame of the move. */
  start: number
  /** The last frame of the move, where it reaches `to`. */
  end: number
  from: T
  to: T
  easing?: Easing
}

interface VariableState<T> {
  initial: T
  kind: Kind
  segments: Segment<T>[]
  /** The animation that moves it; a variable is moved by one animation only. */
  owner: object | null
}

/**
 * A value that animations move. Call it to read it at the current frame; that is followed like
 * any accessor, so it can be passed as a style value as it is.
 */
export interface Variable<T> {
  (): T
  /** The value at `frame` (relative to the clip it was made in). */
  at(frame: number): T
  /** The same as calling it. */
  use(): T
  /** @internal */
  readonly state: VariableState<T>
}

function kindOf(value: unknown): Kind | null {
  if (typeof value === "number") return "number"
  if (typeof value === "string") return parseColor(value) === null ? null : "color"
  if (typeof value === "object" && value !== null) {
    const v = value as Partial<Vec3>
    if (typeof v.x === "number" && typeof v.y === "number") {
      return typeof v.z === "number" ? "vec3" : "vec2"
    }
  }
  return null
}

function lerp<T>(kind: Kind, from: T, to: T, t: number): T {
  const mix = (a: number, b: number) => a + (b - a) * t
  switch (kind) {
    case "number":
      return mix(from as number, to as number) as T
    case "vec2": {
      const a = from as Vec2
      const b = to as Vec2
      return { x: mix(a.x, b.x), y: mix(a.y, b.y) } as T
    }
    case "vec3": {
      const a = from as Vec3
      const b = to as Vec3
      return { x: mix(a.x, b.x), y: mix(a.y, b.y), z: mix(a.z, b.z) } as T
    }
    case "color":
      return mixColor(from as string, to as string, t) as T
  }
}

function equalsFor(kind: Kind): (a: unknown, b: unknown) => boolean {
  switch (kind) {
    case "vec2":
      return (a, b) => (a as Vec2).x === (b as Vec2).x && (a as Vec2).y === (b as Vec2).y
    case "vec3":
      return (a, b) =>
        (a as Vec3).x === (b as Vec3).x && (a as Vec3).y === (b as Vec3).y &&
        (a as Vec3).z === (b as Vec3).z
    default:
      return Object.is
  }
}

/** The value at `frame`: the move it is in, or where the last one before it ended. */
function sample<T>(state: VariableState<T>, frame: number): T {
  const segments = state.segments
  // The last segment that starts at or before the frame.
  let low = 0
  let high = segments.length - 1
  let found = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (segments[mid].start <= frame) {
      found = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  if (found < 0) return state.initial
  const s = segments[found]
  if (frame >= s.end) return s.to
  const span = s.end - s.start
  const t = span <= 0 ? 1 : (frame - s.start) / span
  return lerp(state.kind, s.from, s.to, s.easing ? s.easing(t) : t)
}

/**
 * Makes a variable for animations to move. It can hold a number, `{ x, y }`, `{ x, y, z }` or a
 * color (`#rrggbb`).
 */
export function useVariable(initial: number): Variable<number>
export function useVariable(initial: Vec2): Variable<Vec2>
export function useVariable(initial: Vec3): Variable<Vec3>
export function useVariable(initial: ColorHex): Variable<ColorHex>
export function useVariable<T extends VariableType>(initial: T): Variable<T> {
  const kind = kindOf(initial)
  if (!kind) throw new TypeError(`useVariable: ${JSON.stringify(initial)} can't be animated`)
  const state: VariableState<T> = { initial, kind, segments: [], owner: null }
  const frame = useCurrentFrame()
  const at = (f: number) => sample(state, f)
  const value = createMemo(() => at(frame()), equalsFor(kind) as (a: T, b: T) => boolean)
  const variable = (() => value()) as Variable<T>
  return Object.assign(variable, { at, use: variable, state })
}

/** What awaiting an animation step waits for: its end, on the script's clock. */
export class AnimationHandle {
  #resolved = false
  constructor(private readonly ctx: Script, readonly endFrame: number) {}

  then(resolve: () => void, _reject?: (reason?: unknown) => void): void {
    if (!this.#resolved) {
      this.#resolved = true
      this.ctx.advance(this.endFrame)
    }
    resolve()
  }
}

export interface MoveController<T> {
  /** Moves from wherever it is to `value` in `frames`, starting now. */
  to(value: T, frames: number, easing?: Easing): AnimationHandle
  /** Jumps to `value` now. */
  set(value: T): AnimationHandle
}

export interface AnimationContext {
  /** Where the script is, in frames of its clip. */
  readonly now: number
  /** Waits `frames`. */
  sleep(frames: number): AnimationHandle
  /** Waits until `frame` of the clip. */
  waitUntil(frame: number): AnimationHandle
  /** Waits until the clip with this label starts. It has to come before this in the project. */
  waitUntilClip(label: string): AnimationHandle
  move<T extends VariableType>(variable: Variable<T>): MoveController<T>
  /** Ends when the last of `handles` does. */
  parallel(handles: AnimationHandle[]): AnimationHandle
}

class Script implements AnimationContext {
  now = 0
  end = 0
  constructor(private readonly clipStart: number) {}

  advance(frame: number) {
    this.now = Math.max(this.now, frame)
    this.end = Math.max(this.end, this.now)
  }

  sleep(frames: number) {
    return new AnimationHandle(this, this.now + toFrames(frames))
  }

  waitUntil(frame: number) {
    return new AnimationHandle(this, Math.max(this.now, toFrames(frame)))
  }

  waitUntilClip(label: string) {
    const clip = findClip(label)
    if (!clip) {
      throw new Error(
        `waitUntilClip: there is no clip "${label}" before this animation (clips are found in the order they are made)`,
      )
    }
    return this.waitUntil(untrack(clip.start) - this.clipStart)
  }

  move<T extends VariableType>(variable: Variable<T>): MoveController<T> {
    const state = variable.state as VariableState<T>
    if (state.owner && state.owner !== this) {
      throw new Error("useAnimation: a variable can only be moved by one animation")
    }
    state.owner = this
    const push = (segment: Segment<T>) => {
      const segments = state.segments
      // A move that starts before the end of the last one cuts it off there.
      while (segments.length && segments[segments.length - 1].start >= segment.start) segments.pop()
      segments.push(segment)
    }
    return {
      to: (value, frames, easing) => {
        if (kindOf(value) !== state.kind) {
          throw new TypeError(`useAnimation: ${JSON.stringify(value)} is not a ${state.kind} like the variable`)
        }
        const start = this.now
        const end = start + Math.max(1, toFrames(frames)) - 1
        push({ start, end, from: sample(state, start), to: value, easing })
        this.end = Math.max(this.end, end + 1)
        return new AnimationHandle(this, end + 1)
      },
      set: (value) => {
        push({ start: this.now, end: this.now, from: value, to: value })
        return new AnimationHandle(this, this.now)
      },
    }
  }

  parallel(handles: AnimationHandle[]) {
    return new AnimationHandle(this, Math.max(this.now, ...handles.map((h) => h.endFrame)))
  }
}

function toFrames(value: number): number {
  return Math.max(0, Math.round(value))
}

/**
 * Runs an animation script for the variables of the component, now. The clip it is in lasts at
 * least until the script ends, unless it was given a duration.
 */
export function useAnimation(
  run: (ctx: AnimationContext) => Promise<void> | void,
): { durationFrames: number } {
  const clip = useClip()
  const script = new Script(clip ? untrack(clip.start) : 0)
  let done = false
  let failure: unknown = null
  const result = untrack(() => run(script))
  if (result && typeof (result as Promise<void>).then === "function") {
    ;(result as Promise<void>).then(
      () => (done = true),
      (e) => {
        failure = e
        done = true
      },
    )
    // Every await is on a handle, which resolves at once: the whole script runs through here.
    runMicrotasks()
  } else {
    done = true
  }
  if (failure) throw failure
  if (!done) {
    throw new Error(
      "useAnimation: the animation waited for something other than its own handles (only await what ctx gives)",
    )
  }
  const durationFrames = Math.max(1, script.end)
  if (clip) clip.need(() => durationFrames)
  else needAtRoot(() => durationFrames)
  return { durationFrames }
}

export type { Accessor }
