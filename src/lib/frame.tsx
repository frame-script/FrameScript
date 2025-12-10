import React, { useContext, useEffect, useState } from "react"
import { PROJECT_SETTINGS } from "../../project/project"
import { useClipStart as useClipStart } from "./clip"

type CurrentFrame = {
  currentFrame: number
  setCurrentFrame: (frame: number) => void
}

const CurrentFrameContext = React.createContext<CurrentFrame | null>(null)

export const WithCurrentFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentFrame, setCurrentFrame] = useState(0)

  useEffect(() => {
    // Expose setters for headless rendering / automation (e.g., Chromium driving frames)
    const api = {
      setFrame: (frame: number) => setCurrentFrame(Math.max(0, Math.floor(frame))),
      getFrame: () => currentFrame,
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
  }, [currentFrame])

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
  if (clipStart !== null) {
    return Math.max(ctx.currentFrame - clipStart, 0)
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
