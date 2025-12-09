import React, { useCallback, useContext, useMemo, useState, useSyncExternalStore } from "react"

type TimeLineProps = {
  children?: React.ReactNode
}

export type TimelineClip = {
  id: string
  start: number
  end: number
  label?: string
  depth?: number
  parentId?: string | null
  laneId?: string
}

type TimelineContextValue = {
  clips: TimelineClip[]
  registerClip: (clip: TimelineClip) => void
  unregisterClip: (id: string) => void
  setClipVisibility: (id: string, visible: boolean) => void
}

const TimelineContext = React.createContext<TimelineContextValue | null>(null)

type Listener = () => void

let globalClips: TimelineClip[] = []
let globalHidden: Record<string, boolean> = {}
const globalListeners = new Set<Listener>()

const subscribeGlobal = (listener: Listener) => {
  globalListeners.add(listener)
  return () => globalListeners.delete(listener)
}

const notifyGlobal = () => {
  globalListeners.forEach((listener) => listener())
}

const getGlobalClips = () => globalClips

export const registerClipGlobal = (clip: TimelineClip) => {
  globalClips = [...globalClips.filter((item) => item.id !== clip.id), clip]
  notifyGlobal()
}

export const unregisterClipGlobal = (id: string) => {
  globalClips = globalClips.filter((clip) => clip.id !== id)
  delete globalHidden[id]
  notifyGlobal()
}

export const setClipVisibilityGlobal = (id: string, visible: boolean) => {
  if (visible) {
    const { [id]: _, ...rest } = globalHidden
    globalHidden = rest
  } else {
    globalHidden = { ...globalHidden, [id]: true }
  }
  notifyGlobal()
}

const getGlobalHidden = () => globalHidden

export const TimeLine = ({ children }: TimeLineProps) => {
  const existingContext = useContext(TimelineContext)
  const [clips, setClips] = useState<TimelineClip[]>([])

  const registerClip = useCallback((clip: TimelineClip) => {
    setClips((prev) => {
      const next = prev.filter((item) => item.id !== clip.id)
      return [...next, clip]
    })
    registerClipGlobal(clip)
  }, [])

  const unregisterClip = useCallback((id: string) => {
    setClips((prev) => prev.filter((clip) => clip.id !== id))
    unregisterClipGlobal(id)
  }, [])

  const setClipVisibility = useCallback((id: string, visible: boolean) => {
    setClipVisibilityGlobal(id, visible)
  }, [])

  const value = useMemo(
    () => ({
      clips,
      registerClip,
      unregisterClip,
      setClipVisibility,
    }),
    [clips, registerClip, unregisterClip, setClipVisibility],
  )

  if (existingContext) {
    return <>{children}</>
  }

  return <TimelineContext.Provider value={value}>{children}</TimelineContext.Provider>
}

export const useTimelineClips = () => {
  const context = useContext(TimelineContext)
  const clips = useSyncExternalStore(subscribeGlobal, getGlobalClips)
  if (context) {
    return context.clips
  }
  return clips
}

export const useTimelineRegistration = () => {
  return useContext(TimelineContext)
}

export const useClipVisibilityState = () => {
  const context = useContext(TimelineContext)
  const hidden = useSyncExternalStore(subscribeGlobal, getGlobalHidden)

  if (context) {
    return {
      hiddenMap: hidden,
      setClipVisibility: context.setClipVisibility,
    }
  }

  return {
    hiddenMap: hidden,
    setClipVisibility: setClipVisibilityGlobal,
  }
}

export const useClipVisibility = (id: string) => {
  const { hiddenMap } = useClipVisibilityState()
  const clips = useTimelineClips()
  const getParentId = (clipId: string) => clips.find((c) => c.id === clipId)?.parentId ?? null

  let cursor: string | null = id
  while (cursor) {
    if (hiddenMap[cursor]) return false
    cursor = getParentId(cursor)
  }
  return true
}
