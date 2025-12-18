import React, { createContext, useContext } from "react"
import { Store } from "../util/state"

export type StudioState = {
  isPlaying: boolean
  setIsPlaying: (flag: boolean) => void
  isPlayingStore: Store<boolean>
  isRender: boolean
}

export const StudioStateContext = createContext<StudioState | null>(null)

export const useIsPlaying = () => {
  const ctx = useContext(StudioStateContext)
  if (!ctx) throw new Error("useIsPlaying must be used inside <StudioStateContext>")
  return ctx.isPlaying
}

export const useSetIsPlaying = () => {
  const ctx = useContext(StudioStateContext)
  if (!ctx) throw new Error("useSetIsPlaying must be used inside <StudioStateContext>")
  return ctx.setIsPlaying
}

export const useIsPlayingStore = () => {
  const ctx = useContext(StudioStateContext)
  if (!ctx) throw new Error("useIsPlayingStore must be used inside <StudioStateContext>")
  return ctx.isPlayingStore
}

export const useIsRender = () => {
  const ctx = useContext(StudioStateContext)
  if (!ctx) throw new Error("useIsRender must be used inside <StudioStateContext>")
  return ctx.isRender
}

