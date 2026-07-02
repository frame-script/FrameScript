import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  WithClipStart,
  WithFrameUpdates,
  useCurrentFrame,
  useGlobalFrameSelector,
} from "./frame"
import { useClipVisibility, useTimelineRegistration } from "./timeline"
import { registerClipGlobal, unregisterClipGlobal } from "./timeline"
import { PROJECT_SETTINGS } from "../../project/project"
import { logPerfSpike } from "./perf-debug"

type ClipStaticProps = {
  start: number
  end: number
  label?: string
  children?: React.ReactNode
  laneId?: string
  timelinePending?: boolean
}

type ClipContextValue = {
  id: string
  baseStart: number
  baseEnd: number
  depth: number
  active: boolean
  timelinePending: boolean
}

const ClipContext = createContext<ClipContextValue | null>(null)

type DurationReporter = {
  set: (id: string, frames: number) => void
  remove: (id: string) => void
}

// Duration reporting from descendants (used by Clip)
const DurationReportContext = createContext<DurationReporter | null>(null)

/**
 * Reports a clip duration from inside a child component.
 *
 * 子コンポーネントからクリップ長を報告します。
 *
 * @example
 * ```tsx
 * const duration = seconds(2)
 * useProvideClipDuration(duration)
 * ```
 */
export const useProvideClipDuration = (frames: number | null | undefined) => {
  const report = useContext(DurationReportContext)
  const id = useId()
  useEffect(() => {
    if (!report) return
    if (frames == null) {
      report.remove(id)
      return
    }

    report.set(id, Math.max(0, frames))
    return () => {
      report.remove(id)
    }
  }, [report, frames, id])
}

// Static clip with explicit start/end. Treated as length 0 unless caller provides span.
/**
 * Renders a clip with explicit start/end frames.
 *
 * 明示的な start/end を持つ静的クリップを描画します。
 *
 * @example
 * ```tsx
 * <ClipStatic start={0} end={120} label="Intro">
 *   <Scene />
 * </ClipStatic>
 * ```
 */
export const ClipStatic = ({
  start,
  end,
  label,
  children,
  laneId,
  timelinePending = false,
}: ClipStaticProps) => {
  const timeline = useTimelineRegistration()
  const registerClip = timeline?.registerClip
  const unregisterClip = timeline?.unregisterClip
  const id = useId()
  const isVisible = useClipVisibility(id)

  const clipContext = useContext(ClipContext)

  const parentBase = clipContext?.baseStart ?? 0
  const parentEnd = clipContext?.baseEnd ?? Number.POSITIVE_INFINITY
  const parentDepth = clipContext?.depth ?? -1
  const parentId = clipContext?.id ?? null
  const pending = timelinePending || (clipContext?.timelinePending ?? false)
  const absoluteStart = parentBase + start
  const absoluteEnd = parentBase + end
  const clampedStart = Math.max(absoluteStart, parentBase)
  const clampedEnd = Math.min(absoluteEnd, parentEnd)
  const hasSpan = clampedEnd >= clampedStart
  const depth = parentDepth + 1
  const isInFrameRange = useGlobalFrameSelector(
    (frame) => hasSpan && frame >= clampedStart && frame <= clampedEnd,
  )
  const isActive = isInFrameRange && isVisible

  useEffect(() => {
    if (!hasSpan) return

    if (registerClip && unregisterClip) {
      registerClip({
        id,
        start: clampedStart,
        end: clampedEnd,
        label,
        depth,
        parentId,
        laneId,
        pending,
      })
      return () => {
        unregisterClip(id)
      }
    }

    registerClipGlobal({
      id,
      start: clampedStart,
      end: clampedEnd,
      label,
      depth,
      parentId,
      laneId,
      pending,
    })
    return () => unregisterClipGlobal(id)
  }, [
    registerClip,
    unregisterClip,
    id,
    clampedStart,
    clampedEnd,
    label,
    depth,
    hasSpan,
    parentId,
    laneId,
    pending,
  ])

  return (
    <ClipContext.Provider
      value={{
        id,
        baseStart: clampedStart,
        baseEnd: clampedEnd,
        depth,
        active: isActive,
        timelinePending: pending,
      }}
    >
      <WithClipStart start={clampedStart}>
        <WithFrameUpdates enabled={isActive}>
          <div style={{ display: isActive ? "contents" : "none" }}>
            {children}
          </div>
        </WithFrameUpdates>
      </WithClipStart>
    </ClipContext.Provider>
  )
}

/**
 * Returns the absolute start frame of the current clip.
 *
 * 現在のクリップの開始フレームを返します。
 *
 * @example
 * ```ts
 * const start = useClipStart()
 * ```
 */
export const useClipStart = () => {
  const ctx = useContext(ClipContext)
  return ctx?.baseStart ?? null
}

/**
 * Returns the absolute frame range of the current clip.
 *
 * 現在のクリップの範囲を返します。
 *
 * @example
 * ```ts
 * const range = useClipRange()
 * ```
 */
export const useClipRange = () => {
  const ctx = useContext(ClipContext)
  const start = ctx?.baseStart ?? null
  const end = ctx?.baseEnd ?? null
  return useMemo(() => {
    if (start === null || end === null) return null
    return { start, end }
  }, [start, end])
}

/**
 * Returns the id of the current clip.
 *
 * 現在のクリップ ID を返します。
 *
 * @example
 * ```ts
 * const id = useClipId()
 * ```
 */
export const useClipId = () => {
  const ctx = useContext(ClipContext)
  return ctx?.id ?? null
}

/**
 * Returns the nesting depth of the current clip.
 *
 * 現在のクリップのネスト深度を返します。
 *
 * @example
 * ```ts
 * const depth = useClipDepth()
 * ```
 */
export const useClipDepth = () => {
  const ctx = useContext(ClipContext)
  return ctx?.depth ?? null
}

/**
 * Returns true when the current clip is active and visible.
 *
 * 現在のクリップがアクティブかつ表示中なら true を返します。
 *
 * @example
 * ```ts
 * const active = useClipActive()
 * ```
 */
export const useClipActive = () => {
  const ctx = useContext(ClipContext)
  return ctx?.active ?? false
}

type ClipStaticElement = React.ReactElement<ClipStaticProps>

type ClipProps = {
  start?: number
  label?: string
  duration?: number // frames
  laneId?: string
  children?: React.ReactNode
  timelinePending?: boolean
  onDurationChange?: (frames: number, resolved?: boolean) => void
}

const ClipAnimationSync = ({ children }: { children: React.ReactNode }) => {
  const localFrame = useCurrentFrame()
  const active = useClipActive()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const animationsRef = useRef<Animation[]>([])
  const dirtyRef = useRef(true)

  const collectAnimations = useCallback(() => {
    const startMs = performance.now()
    const root = rootRef.current
    if (!root) {
      animationsRef.current = []
      dirtyRef.current = false
      return
    }

    const animations: Animation[] = []
    // Collect animations under this clip, but don't trample nested clips that have their own clock.
    // (Nested clips register their own root wrapper with `data-framescript-clip-root`.)
    const ATTR = "data-framescript-clip-root"
    const stack: Element[] = [root]
    while (stack.length > 0) {
      const el = stack.pop()!
      animations.push(...el.getAnimations())
      for (const child of Array.from(el.children)) {
        if (child !== root && child.hasAttribute(ATTR)) continue
        stack.push(child)
      }
    }

    animationsRef.current = animations
    dirtyRef.current = false
    logPerfSpike("clip.collectAnimations", performance.now() - startMs, {
      animations: animations.length,
    })
  }, [])

  useLayoutEffect(() => {
    if (!active) {
      animationsRef.current = []
      dirtyRef.current = true
      return
    }

    const root = rootRef.current
    if (!root) return

    dirtyRef.current = true
    const observer = new MutationObserver(() => {
      dirtyRef.current = true
    })
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    })

    return () => {
      observer.disconnect()
    }
  }, [active])

  useLayoutEffect(() => {
    if (!active) return

    const startMs = performance.now()
    const fps = PROJECT_SETTINGS.fps
    if (fps <= 0) return

    const timeMs = (localFrame / fps) * 1000

    if (dirtyRef.current) {
      collectAnimations()
    }

    const nextAnimations: Animation[] = []
    for (const anim of animationsRef.current) {
      try {
        // Drive CSS animations by timeline scrubbing rather than wall-clock time.
        if (anim.playState !== "paused") anim.pause()
        anim.currentTime = timeMs
        nextAnimations.push(anim)
      } catch {
        // Ignore detached animations and drop them from cache.
      }
    }
    animationsRef.current = nextAnimations
    logPerfSpike("clip.syncAnimations", performance.now() - startMs, {
      animations: nextAnimations.length,
      localFrame,
    })
  }, [active, collectAnimations, localFrame])

  return (
    <div
      ref={rootRef}
      style={{ display: "contents" }}
      data-framescript-clip-root="1"
    >
      {children}
    </div>
  )
}

// Clip (duration-aware): computes its duration from children via useProvideClipDuration or duration prop.
/**
 * Duration-aware clip that derives length from children or `duration`.
 *
 * 子要素の報告や `duration` から長さを決めるクリップです。
 *
 * @example
 * ```tsx
 * <Clip label="Intro" duration={seconds(2)}>
 *   <IntroScene />
 * </Clip>
 * ```
 */
export const Clip = ({
  start = 0,
  label,
  duration,
  laneId,
  children,
  timelinePending = false,
  onDurationChange,
}: ClipProps) => {
  const [frames, setFrames] = useState<number>(Math.max(0, duration ?? 0))
  const [reportCount, setReportCount] = useState(0)
  const durationsRef = useRef<Map<string, number>>(new Map())

  const resolveReported = useCallback(() => {
    let max = 0
    for (const value of durationsRef.current.values()) {
      if (value > max) max = value
    }
    const next = duration != null ? Math.max(0, duration) : max
    setFrames((prev) => (prev === next ? prev : next))
  }, [duration])

  const handleReport = useCallback(
    (id: string, value: number) => {
      const hadReport = durationsRef.current.has(id)
      durationsRef.current.set(id, Math.max(0, value))
      if (!hadReport) {
        setReportCount((prev) => prev + 1)
      }
      resolveReported()
    },
    [resolveReported],
  )

  const handleRemoveReport = useCallback(
    (id: string) => {
      if (!durationsRef.current.has(id)) return
      durationsRef.current.delete(id)
      setReportCount((prev) => Math.max(0, prev - 1))
      resolveReported()
    },
    [resolveReported],
  )

  const durationReporter = useMemo(
    () => ({ set: handleReport, remove: handleRemoveReport }),
    [handleReport, handleRemoveReport],
  )

  useEffect(() => {
    if (duration != null) {
      setFrames(Math.max(0, duration))
    } else {
      resolveReported()
    }
  }, [duration, resolveReported])

  const durationResolved = duration != null || reportCount > 0

  useEffect(() => {
    if (onDurationChange) {
      onDurationChange(frames, durationResolved)
    }
  }, [durationResolved, frames, onDurationChange])

  useProvideClipDuration(durationResolved ? frames : null)

  const end = start + Math.max(0, frames) - 1

  return (
    <DurationReportContext.Provider value={durationReporter}>
      <ClipStatic
        start={start}
        end={end < start ? start : end}
        label={label}
        laneId={laneId}
        timelinePending={timelinePending}
      >
        <ClipAnimationSync>{children}</ClipAnimationSync>
      </ClipStatic>
    </DurationReportContext.Provider>
  )
}
;(Clip as any)._isClip = true

// Places child <ClipStatic> components back-to-back on the same lane by rewiring their start/end.
// Each child's duration is preserved (end - start inclusive); next clip starts at previous end + 1.
/**
 * Places <ClipStatic> elements sequentially on the same lane.
 *
 * <ClipStatic> を同一レーンで直列配置します。
 *
 * @example
 * ```tsx
 * <Serial>
 *   <ClipStatic start={0} end={59} label="A">...</ClipStatic>
 *   <ClipStatic start={0} end={29} label="B">...</ClipStatic>
 * </Serial>
 * ```
 */
export const Serial = ({ children }: { children: React.ReactNode }) => {
  const laneId = useId()
  const clips = Children.toArray(children).filter(
    isValidElement,
  ) as ClipStaticElement[]
  if (clips.length === 0) return null

  const baseStart = clips[0].props.start ?? 0
  let cursor = baseStart

  const serialised = clips.map((el, index) => {
    const { start, end } = el.props
    const duration = Math.max(0, end - start) // inclusive span
    const nextStart = index === 0 ? baseStart : cursor
    const nextEnd = nextStart + duration
    cursor = nextEnd + 1

    return cloneElement(el, {
      start: nextStart,
      end: nextEnd,
      laneId,
      key: el.key ?? index,
    })
  })

  return <>{serialised}</>
}

type ClipElementDyn = React.ReactElement<ClipProps>
type SequenceElement = React.ReactElement<Record<string, unknown>>
type ClipSequenceProps = {
  children: React.ReactNode
  start?: number
  timelinePending?: boolean
  onDurationChange?: (frames: number, resolved?: boolean) => void
}

type SequenceDuration = {
  frames: number
  resolved: boolean
}

const inferSequenceElementLabel = (el: SequenceElement) => {
  const type = el.type
  if (typeof type === "string") {
    return typeof el.props.label === "string" ? el.props.label : type
  }
  return (
    (type as { displayName?: string; name?: string }).displayName ??
    (type as { displayName?: string; name?: string }).name
  )
}

/**
 * Chains <Clip> elements back-to-back and behaves like a single clip.
 *
 * <Clip> を連結して 1 つのクリップのように扱います。
 *
 * @example
 * ```tsx
 * <ClipSequence>
 *   <Clip label="A">...</Clip>
 *   <Clip label="B">...</Clip>
 * </ClipSequence>
 * ```
 */
export const ClipSequence = ({
  children,
  start = 0,
  timelinePending = false,
  onDurationChange,
}: ClipSequenceProps) => {
  const laneId = useId()
  const items = Children.toArray(children).filter(isValidElement) as (
    | ClipElementDyn
    | SequenceElement
  )[]
  const [durations, setDurations] = useState<Map<string, SequenceDuration>>(
    new Map(),
  )

  const handleDurationChange = useCallback(
    (key: string) =>
      (value: number, resolved = true) => {
        setDurations((prev) => {
          const next = new Map(prev)
          next.set(key, { frames: Math.max(0, value), resolved })
          // Avoid useless updates that can cause render loops when value is unchanged.
          const current = prev.get(key)
          if (
            current &&
            current.frames === Math.max(0, value) &&
            current.resolved === resolved
          ) {
            return prev
          }
          return next
        })
      },
    [],
  )

  let cursor = start
  let maxCursor = start
  let cursorResolved = true
  let totalResolved = true
  const serialised = items.map((el, index) => {
    const key = (el.key ?? index).toString()
    const isForkSequence = Boolean((el.type as any)?._isClipForkSequence)
    const isClipElement = Boolean((el.type as any)?._isClip)
    const propDuration =
      typeof el.props.duration === "number" ? el.props.duration : 0
    const duration = durations.get(key)
    const durationResolved =
      duration?.resolved ?? typeof el.props.duration === "number"
    const knownDuration = duration?.frames ?? Math.max(0, propDuration)
    const nextStart = cursor
    const startPending = timelinePending || !cursorResolved

    if (isForkSequence) {
      maxCursor = Math.max(maxCursor, nextStart + knownDuration)
      totalResolved = totalResolved && durationResolved
      return cloneElement(el, {
        start: nextStart,
        key,
        timelinePending: startPending,
        onDurationChange: handleDurationChange(key),
      })
    }

    cursor = cursor + knownDuration
    maxCursor = Math.max(maxCursor, cursor)
    totalResolved = totalResolved && durationResolved
    cursorResolved = cursorResolved && durationResolved

    if (!isClipElement) {
      return (
        <Clip
          start={nextStart}
          duration={
            typeof el.props.duration === "number" ? propDuration : undefined
          }
          label={inferSequenceElementLabel(el)}
          laneId={laneId}
          timelinePending={startPending}
          key={key}
          onDurationChange={handleDurationChange(key)}
        >
          {el}
        </Clip>
      )
    }

    return cloneElement(el, {
      start: nextStart,
      laneId,
      key,
      timelinePending: startPending,
      onDurationChange: handleDurationChange(key),
    })
  })

  const total = maxCursor - start
  useProvideClipDuration(totalResolved ? total : null)

  if (items.length === 0) return null

  useEffect(() => {
    if (onDurationChange) {
      onDurationChange(total, totalResolved)
    }
  }, [onDurationChange, total, totalResolved])

  return <>{serialised}</>
}
;(ClipSequence as any)._isClip = true

/**
 * Starts a parallel branch inside <ClipSequence> without advancing the parent sequence.
 *
 * 親の <ClipSequence> の現在位置から並列の枝を開始します。
 *
 * @example
 * ```tsx
 * <ClipSequence>
 *   <Clip label="A">...</Clip>
 *   <ClipForkSequence>
 *     <Clip label="Fork">...</Clip>
 *   </ClipForkSequence>
 *   <Clip label="B">...</Clip>
 * </ClipSequence>
 * ```
 */
export const ClipForkSequence = ({
  children,
  start = 0,
  timelinePending = false,
  onDurationChange,
}: ClipSequenceProps) => {
  return (
    <ClipSequence
      start={start}
      timelinePending={timelinePending}
      onDurationChange={onDurationChange}
    >
      {children}
    </ClipSequence>
  )
}
;(ClipForkSequence as any)._isClipForkSequence = true
