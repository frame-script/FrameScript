import React, { useContext, useState } from "react"
import { PROJECT_SETTINGS } from "../../project/project"
import { useClipContext as useClipStart } from "./clip"

type CurrentFrame = {
  currentFrame: number
  setCurrentFrame: (frame: number) => void
}

const CurrentFrameContext = React.createContext<CurrentFrame | null>(null)

export const WithCurrentFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentFrame, setCurrentFrame] = useState(0)

  return (
    <CurrentFrameContext value={{ currentFrame, setCurrentFrame }}>
      {children}
    </CurrentFrameContext>
  )
}

export const useCurrentFrame = () => {
  const ctx = useContext(CurrentFrameContext);
  if (!ctx) throw new Error("useCurrentFrame must be used inside <Timeline>");

  const clipStart = useClipStart()
  if (clipStart) {
    return ctx.currentFrame - clipStart
  }

  return ctx.currentFrame;
}

export const useGlobalCurrentFrame = () => {
  const ctx = useContext(CurrentFrameContext);
  if (!ctx) throw new Error("useCurrentFrame must be used inside <Timeline>");
  return ctx.currentFrame;
}

export const useSetGlobalCurrentFrame = () => {
  const ctx = useContext(CurrentFrameContext)
  if (!ctx) throw new Error("useCurrentFrame must be used inside <Timeline>");
  return ctx.setCurrentFrame;
}

export function seconds(seconds: number): number {
  return PROJECT_SETTINGS.fps * seconds
}
