import React, { useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import { PROJECT_SETTINGS } from "../../project/project"

type FrameStore = {
  get: () => number
  set: (frame: number) => void
  subscribe: (listener: () => void) => () => void
}

const CURRENT_FRAME_CONTEXT_KEY = "__frameScript_CurrentFrameContext"
const CLIP_START_CONTEXT_KEY = "__frameScript_ClipStartContext"
const FRAME_UPDATES_ENABLED_CONTEXT_KEY = "__frameScript_FrameUpdatesEnabledContext"
const CurrentFrameContext: React.Context<FrameStore | null> = (() => {
  const g = globalThis as unknown as Record<string, unknown>
  const existing = g[CURRENT_FRAME_CONTEXT_KEY] as React.Context<FrameStore | null> | undefined
  if (existing) return existing
  const created = React.createContext<FrameStore | null>(null)
  g[CURRENT_FRAME_CONTEXT_KEY] = created
  return created
})()

const ClipStartContext: React.Context<number | null> = (() => {
  const g = globalThis as unknown as Record<string, unknown>
  const existing = g[CLIP_START_CONTEXT_KEY] as React.Context<number | null> | undefined
  if (existing) return existing
  const created = React.createContext<number | null>(null)
  g[CLIP_START_CONTEXT_KEY] = created
  return created
})()

const FrameUpdatesEnabledContext: React.Context<boolean> = (() => {
  const g = globalThis as unknown as Record<string, unknown>
  const existing = g[FRAME_UPDATES_ENABLED_CONTEXT_KEY] as React.Context<boolean> | undefined
  if (existing) return existing
  const created = React.createContext<boolean>(true)
  g[FRAME_UPDATES_ENABLED_CONTEXT_KEY] = created
  return created
})()

const createFrameStore = (initialFrame = 0): FrameStore => {
  let currentFrame = Math.max(0, Math.floor(initialFrame))
  const listeners = new Set<() => void>()

  return {
    get: () => currentFrame,
    set: (frame: number) => {
      const next = Math.max(0, Math.floor(frame))
      if (next === currentFrame) return
      currentFrame = next
      listeners.forEach((listener) => listener())
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * Provides a clip start offset for nested content.
 *
 * クリップの開始フレームを子要素に伝えるための Provider。
 *
 * @example
 * ```tsx
 * <WithClipStart start={60}>
 *   <Scene />
 * </WithClipStart>
 * ```
 */
export const WithClipStart: React.FC<{ start: number; children: React.ReactNode }> = ({ start, children }) => {
  return <ClipStartContext value={start}>{children}</ClipStartContext>
}

/**
 * Enables/disables frame-store updates for descendants.
 *
 * 子孫へのフレーム更新通知を有効/無効にします。
 *
 * @example
 * ```tsx
 * <WithFrameUpdates enabled={false}>
 *   <HeavyTree />
 * </WithFrameUpdates>
 * ```
 */
export const WithFrameUpdates: React.FC<{ enabled: boolean; children: React.ReactNode }> = ({
  enabled,
  children,
}) => {
  return <FrameUpdatesEnabledContext value={enabled}>{children}</FrameUpdatesEnabledContext>
}

const subscribeNever = () => () => {}

/**
 * Reads the global frame using a selector.
 *
 * グローバルフレームを selector 経由で読み取ります。
 *
 * @example
 * ```ts
 * const active = useGlobalFrameSelector((frame) => frame >= 100 && frame <= 200)
 * ```
 */
export const useGlobalFrameSelector = <T,>(selector: (frame: number) => T) => {
  const store = useContext(CurrentFrameContext)
  if (!store) throw new Error("useCurrentFrame must be used inside <WithCurrentFrame>")
  const updatesEnabled = useContext(FrameUpdatesEnabledContext)
  const subscribe = updatesEnabled ? store.subscribe : subscribeNever
  const getSnapshot = () => selector(store.get())
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Provides global current frame state for Studio and renderer.
 *
 * Studio とレンダラのためにグローバルな currentFrame を提供します。
 *
 * @example
 * ```tsx
 * <WithCurrentFrame>
 *   <Project />
 * </WithCurrentFrame>
 * ```
 */
export const WithCurrentFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const storeRef = useRef<FrameStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = createFrameStore(0)
  }
  const store = storeRef.current

  useEffect(() => {
    // Expose setters for headless rendering / automation (e.g., Chromium driving frames)
    const api = {
      setFrame: (frame: number) => store.set(frame),
      getFrame: () => store.get(),
    };
    (window as any).__frameScript = {
      ...(window as any).__frameScript,
      setFrame: api.setFrame,
      getFrame: api.getFrame,
    }
    return () => {
      if ((window as any).__frameScript) {
        delete (window as any).__frameScript.setFrame
        delete (window as any).__frameScript.getFrame
      }
    }
  }, [store])

  const value = useMemo(() => store, [store])

  return <CurrentFrameContext value={value}>{children}</CurrentFrameContext>
}

/**
 * Returns the current frame relative to the nearest clip start.
 *
 * 直近のクリップ開始を基準にした現在フレームを返します。
 *
 * @example
 * ```tsx
 * const frame = useCurrentFrame()
 * ```
 */
export const useCurrentFrame = () => {
  const globalFrame = useGlobalCurrentFrame()
  const clipStart = useContext(ClipStartContext) ?? 0
  return Math.max(globalFrame - clipStart, 0)
}

/**
 * Returns the project-global current frame.
 *
 * プロジェクト全体の現在フレームを返します。
 *
 * @example
 * ```tsx
 * const frame = useGlobalCurrentFrame()
 * ```
 */
export const useGlobalCurrentFrame = () => {
  return useGlobalFrameSelector((frame) => frame)
}

/**
 * Returns a setter to update the global current frame.
 *
 * グローバルの currentFrame を更新する setter を返します。
 *
 * @example
 * ```tsx
 * const setFrame = useSetGlobalCurrentFrame()
 * setFrame(120)
 * ```
 */
export const useSetGlobalCurrentFrame = () => {
  const store = useContext(CurrentFrameContext)
  if (!store) throw new Error("useCurrentFrame must be used inside <WithCurrentFrame>")
  return store.set
}

/**
 * Converts seconds to frames using project FPS.
 *
 * プロジェクトの FPS に基づいて秒数をフレーム数に変換します。
 *
 * @example
 * ```ts
 * const frames = seconds(1.5)
 * ```
 */
export function seconds(seconds: number): number {
  return PROJECT_SETTINGS.fps * seconds
}
