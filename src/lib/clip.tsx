import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useId } from "react"
import { useGlobalCurrentFrame } from "./frame"
import { useClipVisibility, useTimelineRegistration } from "./timeline"
import { registerClipGlobal, unregisterClipGlobal } from "./timeline"

type ClipProps = {
  start: number
  end: number
  label?: string
  children?: React.ReactNode
  laneId?: string
}

type ClipContextValue = { id: string; baseStart: number; baseEnd: number; depth: number; active: boolean }

const ClipContext = createContext<ClipContextValue | null>(null)

export const Clip = ({ start, end, label, children, laneId }: ClipProps) => {
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
  }, [registerClip, unregisterClip, id, clampedStart, clampedEnd, label, depth, hasSpan, parentId])

  return (
    <ClipContext.Provider value={{ id, baseStart: clampedStart, baseEnd: clampedEnd, depth, active: isActive }}>
      <div style={{ display: isActive ? "contents" : "none" }}>
        {children}
      </div>
    </ClipContext.Provider>
  )
}

export const useClipStart = () => {
  const ctx = useContext(ClipContext)
  return ctx?.baseStart ?? null
}

export const useClipDepth = () => {
  const ctx = useContext(ClipContext)
  return ctx?.depth ?? null
}

export const useClipActive = () => {
  const ctx = useContext(ClipContext)
  return ctx?.active ?? false
}

type ClipElement = React.ReactElement<ClipProps>

// Places child <Clip> components back-to-back on the same lane by rewiring their start/end.
// Each child's duration is preserved (end - start inclusive); next clip starts at previous end + 1.
export const Serial = ({ children }: { children: React.ReactNode }) => {
  const laneId = useId()
  const clips = Children.toArray(children).filter(isValidElement) as ClipElement[]
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
