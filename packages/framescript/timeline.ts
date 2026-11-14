/**
 * Clips: what is shown when.
 *
 * A clip is a layer over the whole frame that is shown from its start for its duration, and gives
 * what is inside it a frame of its own (`useCurrentFrame`). Its duration is what it is given, or
 * else what its animations and inner clips need. `<Sequence>` puts the clips in it one after
 * another.
 *
 * ```tsx
 * <Timeline>
 *   <Clip label="title" duration={seconds(3)}><Title /></Clip>
 *   <Sequence>
 *     <Clip label="a"><A /></Clip>   // as long as A's animations
 *     <Clip label="b"><B /></Clip>   // starts when "a" ends
 *   </Sequence>
 * </Timeline>
 * ```
 */

import { type ClipScope, ClipContext, project, useGlobalCurrentFrame } from "./frame.ts"
import { createElement, type JSXNode, provide } from "./jsx.ts"
import {
  type Accessor,
  createContext,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
  useContext,
} from "./reactive.ts"
import type { StyleProps } from "./style.ts"
import * as log from "./internal/log.ts"

export interface ClipProps {
  /** Frames after the start of what it is in. In a `<Sequence>`, after the clip before it. */
  start?: number
  /** In frames. Without it, as long as what is inside needs. */
  duration?: number
  /** Shown on the timeline, and what `ctx.waitUntilClip` finds it by. */
  label?: string
  /** Styles for the layer, which fills the frame and lays out its children in a column. */
  style?: StyleProps
  children?: JSXNode
}

interface Registered {
  scope: ClipScope
  parent: ClipScope | null
}

const clips = new Map<number, Registered>()
let nextId = 1

/** In a `<Sequence>`: where each clip starts, from the clips before it. */
interface SequenceScope {
  place(duration: Accessor<number>): Accessor<number>
}

const SequenceContext = createContext<SequenceScope | null>(null, "sequence")

export function Clip(props: ClipProps): JSXNode {
  const parent = useContext(ClipContext)
  const sequence = useContext(SequenceContext)
  const global = useGlobalCurrentFrame()
  const id = nextId++

  const [needs, setNeeds] = createSignal<Accessor<number>[]>([])
  const duration = createMemo(() => {
    if (props.duration !== undefined) return Math.max(0, Math.round(props.duration))
    const list = needs()
    if (list.length === 0) return sequence ? 0 : Infinity
    return Math.max(0, ...list.map((n) => n()))
  })
  const offset = sequence ? sequence.place(duration) : () => 0
  const start = createMemo(() => (parent ? parent.start() : 0) + offset() + Math.round(props.start ?? 0))
  const frame = createMemo(() => {
    const f = global() - start()
    const last = duration() - 1
    return Math.max(0, Number.isFinite(last) ? Math.min(f, Math.max(0, last)) : f)
  })
  const shown = createMemo(() => {
    const f = global() - start()
    return f >= 0 && f < duration()
  })

  const scope: ClipScope = {
    id,
    label: props.label,
    start,
    duration,
    frame,
    depth: parent ? parent.depth + 1 : 0,
    need: (frames) => setNeeds((list) => [...list, frames]),
  }
  // What the clip takes up in the one it is in.
  parent?.need(() => offset() + Math.round(props.start ?? 0) + finite(duration()))
  clips.set(id, { scope, parent })
  onCleanup(() => clips.delete(id))

  if (sequence && props.duration === undefined) {
    untrack(() => {
      queueCheck(() => {
        if (duration() === 0) {
          log.warn(
            `the clip ${props.label ?? id} in a <Sequence> has no duration and nothing in it says how long it is`,
          )
        }
      })
    })
  }

  // Clips further in are not part of a sequence this one is in.
  const children = provide(ClipContext, scope, provide(SequenceContext, null, props.children))
  return createElement("div", {
    style: {
      position: "absolute",
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      flexDirection: "column",
      ...props.style,
      display: () => (shown() ? "flex" : "none"),
    },
  }, children)
}

/** Puts the clips in it one after another. */
export function Sequence(props: { children?: JSXNode }): JSXNode {
  const placed: Accessor<number>[] = []
  const scope: SequenceScope = {
    place(duration) {
      const before = placed.slice()
      placed.push(duration)
      return createMemo(() => before.reduce((sum, d) => sum + finite(d()), 0))
    },
  }
  return provide(SequenceContext, scope, props.children)
}

/** The root of the clips. It is only there to be read; clips work without it. */
export function Timeline(props: { children?: JSXNode }): JSXNode {
  return props.children
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0
}

const checks: (() => void)[] = []

function queueCheck(f: () => void) {
  checks.push(f)
}

/** @internal Runs what waits until everything is made. */
export function runChecks(): void {
  for (const f of checks.splice(0)) f()
}

/** What animations outside any clip need. */
const rootNeeds: Accessor<number>[] = []

/** @internal An animation outside any clip makes the project last at least `frames`. */
export function needAtRoot(frames: Accessor<number>): void {
  rootNeeds.push(frames)
}

/** @internal How long the project is, in frames. */
export function projectDuration(): number {
  if (project.duration) return Math.max(1, Math.round(project.duration * project.fps))
  let end = Math.max(0, ...rootNeeds.map((n) => n()))
  for (const { scope } of clips.values()) {
    const d = scope.duration()
    if (Number.isFinite(d)) end = Math.max(end, scope.start() + d)
  }
  return Math.max(1, end)
}

export interface ClipInfo {
  id: number
  label: string | null
  start: number
  end: number
  depth: number
  parent: number | null
}

/** @internal The clips, for the timeline of the studio. */
export function clipInfos(): ClipInfo[] {
  const total = projectDuration()
  return [...clips.values()].map(({ scope, parent }) => {
    const start = scope.start()
    const d = scope.duration()
    return {
      id: scope.id,
      label: scope.label ?? null,
      start,
      end: Number.isFinite(d) ? start + d : Math.max(start, total),
      depth: scope.depth,
      parent: parent?.id ?? null,
    }
  })
}

/** @internal Finds a clip by its label, for `ctx.waitUntilClip`. */
export function findClip(label: string): ClipScope | undefined {
  for (const { scope } of clips.values()) if (scope.label === label) return scope
  return undefined
}
