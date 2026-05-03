import { createContext, useContext } from "react"
import { Store } from "../util/state"

/**
 * Shared studio state for playback and render mode.
 *
 * 再生状態とレンダーモードを共有するスタジオ状態。
 *
 * @example
 * ```tsx
 * const state: StudioState = {
 *   isPlaying: false,
 *   setIsPlaying: () => {},
 *   isPlayingStore: new Store(false),
 *   isRender: false,
 * }
 * ```
 */
export type StudioState = {
  isPlaying: boolean
  setIsPlaying: (flag: boolean) => void
  isPlayingStore: Store<boolean>
  isRender: boolean
}

/**
 * React context that provides studio state to hooks.
 *
 * フックにスタジオ状態を提供する React コンテキスト。
 *
 * @example
 * ```tsx
 * <StudioStateContext.Provider value={state}>
 *   <App />
 * </StudioStateContext.Provider>
 * ```
 */
export const StudioStateContext = createContext<StudioState | null>(null)

/**
 * Returns whether the timeline is currently playing.
 *
 * タイムラインが再生中かどうかを返します。
 *
 * @example
 * ```tsx
 * const playing = useIsPlaying()
 * ```
 */
export const useIsPlaying = () => {
  const ctx = useContext(StudioStateContext)
  if (!ctx)
    throw new Error("useIsPlaying must be used inside <StudioStateContext>")
  return ctx.isPlaying
}

/**
 * Returns the setter used to toggle playback.
 *
 * 再生状態を切り替えるための setter を返します。
 *
 * @example
 * ```tsx
 * const setIsPlaying = useSetIsPlaying()
 * setIsPlaying(true)
 * ```
 */
export const useSetIsPlaying = () => {
  const ctx = useContext(StudioStateContext)
  if (!ctx)
    throw new Error("useSetIsPlaying must be used inside <StudioStateContext>")
  return ctx.setIsPlaying
}

/**
 * Returns the shared Store for playback state.
 *
 * 再生状態の Store を返します。
 *
 * @example
 * ```tsx
 * const store = useIsPlayingStore()
 * ```
 */
export const useIsPlayingStore = () => {
  const ctx = useContext(StudioStateContext)
  if (!ctx)
    throw new Error(
      "useIsPlayingStore must be used inside <StudioStateContext>",
    )
  return ctx.isPlayingStore
}

/**
 * Returns true when running in render mode.
 *
 * レンダーモードで実行中なら true を返します。
 *
 * @example
 * ```tsx
 * const isRender = useIsRender()
 * ```
 */
export const useIsRender = () => {
  const ctx = useContext(StudioStateContext)
  if (!ctx)
    throw new Error("useIsRender must be used inside <StudioStateContext>")
  return ctx.isRender
}
