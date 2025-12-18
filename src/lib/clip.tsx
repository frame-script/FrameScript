import { Children, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react"
import { WithClipStart, useCurrentFrame, useGlobalCurrentFrame } from "./frame"
import { useClipVisibility, useTimelineRegistration } from "./timeline"
import { registerClipGlobal, unregisterClipGlobal } from "./timeline"
import { PROJECT_SETTINGS } from "../../project/project"

type ClipStaticProps = {
  start: number
  end: number
  label?: string
  children?: React.ReactNode
  laneId?: string
}

type ClipContextValue = { id: string; baseStart: number; baseEnd: number; depth: number; active: boolean }

const ClipContext = createContext<ClipContextValue | null>(null)

// Duration reporting from descendants (used by Clip)
const DurationReportContext = createContext<((frames: number) => void) | null>(null)

export const useProvideClipDuration = (frames: number | null | undefined) => {
  const report = useContext(DurationReportContext)
  useEffect(() => {
    if (report && frames != null) {
      report(Math.max(0, frames))
    }
  }, [report, frames])
}

// Static clip with explicit start/end. Treated as length 0 unless caller provides span.
export const ClipStatic = ({ start, end, label, children, laneId }: ClipStaticProps) => {
  const currentFrame = useGlobalCurrentFrame()
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
  const absoluteStart = parentBase + start
  const absoluteEnd = parentBase + end
  const clampedStart = Math.max(absoluteStart, parentBase)
  const clampedEnd = Math.min(absoluteEnd, parentEnd)
  const hasSpan = clampedEnd >= clampedStart
  const depth = parentDepth + 1
  const isActive = hasSpan && currentFrame >= clampedStart && currentFrame <= clampedEnd && isVisible

  useEffect(() => {
    if (!hasSpan) return

    if (registerClip && unregisterClip) {
      registerClip({ id, start: clampedStart, end: clampedEnd, label, depth, parentId, laneId })
      return () => {
        unregisterClip(id)
      }
    }

    registerClipGlobal({ id, start: clampedStart, end: clampedEnd, label, depth, parentId, laneId })
    return () => unregisterClipGlobal(id)
  }, [registerClip, unregisterClip, id, clampedStart, clampedEnd, label, depth, hasSpan, parentId, laneId])

  return (
    <ClipContext.Provider value={{ id, baseStart: clampedStart, baseEnd: clampedEnd, depth, active: isActive }}>
      <WithClipStart start={clampedStart}>
        <div style={{ display: isActive ? "contents" : "none" }}>
          {children}
        </div>
      </WithClipStart>
    </ClipContext.Provider>
  )
}

export const useClipStart = () => {
  const ctx = useContext(ClipContext)
  return ctx?.baseStart ?? null
}

export const useClipRange = () => {
  const ctx = useContext(ClipContext)
  const start = ctx?.baseStart ?? null
  const end = ctx?.baseEnd ?? null
  return useMemo(() => {
    if (start === null || end === null) return null
    return { start, end }
  }, [start, end])
}

export const useClipDepth = () => {
  const ctx = useContext(ClipContext)
  return ctx?.depth ?? null
}

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
  onDurationChange?: (frames: number) => void
}

const ClipAnimationSync = ({ children }: { children: React.ReactNode }) => {
  const localFrame = useCurrentFrame()
  const active = useClipActive()
  const rootRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (!active) return

    const root = rootRef.current
    if (!root) return

    const fps = PROJECT_SETTINGS.fps
    if (fps <= 0) return

    const timeMs = (localFrame / fps) * 1000

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

    for (const anim of animations) {
      try {
        // Drive CSS animations by timeline scrubbing rather than wall-clock time.
        if (anim.playState !== "paused") anim.pause()
        anim.currentTime = timeMs
      } catch {
        // Ignore read-only / detached animations.
      }
    }
  }, [active, localFrame])

  return (
    <div ref={rootRef} style={{ display: "contents" }} data-framescript-clip-root="1">
      {children}
    </div>
  )
}

// Clip (duration-aware): computes its duration from children via useProvideClipDuration or duration prop.
export const Clip = ({
  start = 0,
  label,
  duration,
  laneId,
  children,
  onDurationChange,
}: ClipProps) => {
  const [frames, setFrames] = useState<number>(Math.max(0, duration ?? 0))

  const handleReport = useCallback(
    (value: number) => {
      setFrames((prev) => {
        if (prev === value) return prev
        return value
      })
    },
    [],
  )

  useEffect(() => {
    if (duration != null) {
      setFrames(Math.max(0, duration))
    }
  }, [duration])

  useEffect(() => {
    if (onDurationChange) {
      onDurationChange(frames)
    }
  }, [frames, onDurationChange])

  const end = start + Math.max(0, frames) - 1

  return (
    <DurationReportContext.Provider value={handleReport}>
      <ClipStatic start={start} end={end < start ? start : end} label={label} laneId={laneId}>
        <ClipAnimationSync>{children}</ClipAnimationSync>
      </ClipStatic>
    </DurationReportContext.Provider>
  )
}
  ; (Clip as any)._isClip = true

// Places child <ClipStatic> components back-to-back on the same lane by rewiring their start/end.
// Each child's duration is preserved (end - start inclusive); next clip starts at previous end + 1.
export const Serial = ({ children }: { children: React.ReactNode }) => {
  const laneId = useId()
  const clips = Children.toArray(children).filter(isValidElement) as ClipStaticElement[]
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

// ClipSequence: Chains multiple <Clip> on the same lane, and can be treated as a block via _isClip.
export const ClipSequence = ({
  children,
  start = 0,
  onDurationChange,
}: {
  children: React.ReactNode
  start?: number
  onDurationChange?: (frames: number) => void
}) => {
  const laneId = useId()
  const items = Children.toArray(children).filter(
    (child) => isValidElement(child) && (child as ClipElementDyn).type && ((child as ClipElementDyn).type as any)._isClip,
  ) as ClipElementDyn[]
  const [durations, setDurations] = useState<Map<string, number>>(new Map())

  if (items.length === 0) return null

  const handleDurationChange = useCallback(
    (key: string) => (value: number) => {
      setDurations((prev) => {
        const next = new Map(prev)
        next.set(key, Math.max(0, value))
        // Avoid useless updates that can cause render loops when value is unchanged.
        if (prev.get(key) === next.get(key)) return prev
        return next
      })
    },
    [],
  )

  let cursor = start
  const serialised = items.map((el, index) => {
    const key = (el.key ?? index).toString()
    const knownDuration = durations.get(key) ?? Math.max(0, el.props.duration ?? 0)
    const nextStart = cursor
    cursor = cursor + knownDuration

    return cloneElement(el, {
      start: nextStart,
      laneId,
      key,
      onDurationChange: handleDurationChange(key),
    })
  })

  const total = cursor - start

  useEffect(() => {
    if (onDurationChange) {
      onDurationChange(total)
    }
  }, [onDurationChange, total])

  return <>{serialised}</>
}
(ClipSequence as any)._isClip = true
