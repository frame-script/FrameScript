import React, { useCallback, useContext, useMemo, useState, useSyncExternalStore } from "react"

type TimeLineProps = {
  children?: React.ReactNode
}

/**
 * Timeline clip descriptor registered by <Clip> components.
 *
 * <Clip> が登録するタイムライン情報。
 *
 * @example
 * ```ts
 * const clip: TimelineClip = { id: "intro", start: 0, end: 120 }
 * ```
 */
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

/**
 * Registers a clip in the global timeline store.
 *
 * クリップをグローバルのタイムラインストアに登録します。
 *
 * @example
 * ```ts
 * registerClipGlobal({ id: "intro", start: 0, end: 120 })
 * ```
 */
export const registerClipGlobal = (clip: TimelineClip) => {
  globalClips = [...globalClips.filter((item) => item.id !== clip.id), clip]
  notifyGlobal()
}

/**
 * Unregisters a clip from the global timeline store.
 *
 * グローバルのタイムラインストアからクリップを削除します。
 *
 * @example
 * ```ts
 * unregisterClipGlobal("intro")
 * ```
 */
export const unregisterClipGlobal = (id: string) => {
  globalClips = globalClips.filter((clip) => clip.id !== id)
  delete globalHidden[id]
  notifyGlobal()
}

/**
 * Sets visibility for a clip (and its descendants) in the global store.
 *
 * グローバルストアでクリップの表示/非表示を切り替えます。
 *
 * @example
 * ```ts
 * setClipVisibilityGlobal("intro", false)
 * ```
 */
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

/**
 * Provides timeline registration context for clips.
 *
 * クリップ登録のためのタイムラインコンテキストを提供します。
 *
 * @example
 * ```tsx
 * <TimeLine>
 *   <Clip label="Intro">...</Clip>
 * </TimeLine>
 * ```
 */
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

/**
 * Returns the current list of timeline clips.
 *
 * タイムラインに登録されているクリップ一覧を返します。
 *
 * @example
 * ```ts
 * const clips = useTimelineClips()
 * ```
 */
export const useTimelineClips = () => {
  const context = useContext(TimelineContext)
  const clips = useSyncExternalStore(subscribeGlobal, getGlobalClips)
  if (context) {
    return context.clips
  }
  return clips
}

/**
 * Returns the timeline registration context (if available).
 *
 * クリップ登録用のコンテキストを返します。
 *
 * @example
 * ```ts
 * const timeline = useTimelineRegistration()
 * ```
 */
export const useTimelineRegistration = () => {
  return useContext(TimelineContext)
}

/**
 * Returns visibility state and setter for clips.
 *
 * クリップの表示状態と setter を返します。
 *
 * @example
 * ```ts
 * const { hiddenMap, setClipVisibility } = useClipVisibilityState()
 * ```
 */
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

/**
 * Returns true if the clip and its parents are visible.
 *
 * クリップと親クリップが表示されている場合に true を返します。
 *
 * @example
 * ```ts
 * const visible = useClipVisibility("intro")
 * ```
 */
export const useClipVisibility = (id: string) => {
  const { hiddenMap } = useClipVisibilityState()
  const clips = useTimelineClips()
  const parentMap = useMemo(() => {
    const map = new Map<string, string | null>()
    for (const clip of clips) {
      map.set(clip.id, clip.parentId ?? null)
    }
    return map
  }, [clips])

  return useMemo(() => {
    let cursor: string | null = id
    while (cursor) {
      if (hiddenMap[cursor]) return false
      cursor = parentMap.get(cursor) ?? null
    }
    return true
  }, [hiddenMap, id, parentMap])
}
