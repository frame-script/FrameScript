import { createContext, useContext, useEffect, useId } from "react"
import { useGlobalCurrentFrame } from "./frame"
import { useClipVisibility, useTimelineRegistration } from "./timeline"
import { registerClipGlobal, unregisterClipGlobal } from "./timeline"

type ClipProps = {
  start: number
  end: number
  label?: string
  children: React.ReactNode
}

const ClipContext = createContext<{ clipStart: number } | null>(null)

export const Clip = ({ start, end, label, children }: ClipProps) => {
  const currentFrame = useGlobalCurrentFrame()
  const timeline = useTimelineRegistration()
  const registerClip = timeline?.registerClip
  const unregisterClip = timeline?.unregisterClip
  const id = useId()
  const isVisible = useClipVisibility(id)

  useEffect(() => {
    if (registerClip && unregisterClip) {
      registerClip({ id, start, end, label })
      return () => {
        unregisterClip(id)
      }
    }

    registerClipGlobal({ id, start, end, label })
    return () => unregisterClipGlobal(id)
  }, [registerClip, unregisterClip, id, start, end, label])

  if (currentFrame < start || currentFrame > end) {
    return null
  }

  if (!isVisible) {
    return null
  }

  return (
    <ClipContext value={{ clipStart: start }}>
      {children}
    </ClipContext>
  )
}

export const useClipContext = () => {
  const ctx = useContext(ClipContext)
  if (!ctx) throw new Error("useClipContext must be used inside <ClipContext>")
  return ctx.clipStart
}
