import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useGlobalCurrentFrame, useSetGlobalCurrentFrame } from "../lib/frame"
import { PROJECT_SETTINGS } from "../../project/project"
import { useTimelineClips } from "../lib/timeline"
import { useIsPlaying, useSetIsPlaying } from "../lib/studio-state"

const iconStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1,
  display: "inline-block",
  width: 18,
  textAlign: "center",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
}
const buttonBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "8px 10px",
  background: "#1e293b",
  color: "#e5e7eb",
  border: "1px solid #334155",
  borderRadius: 6,
  cursor: "pointer",
  transition: "background 120ms ease, border-color 120ms ease",
}

const Button = ({
  children,
  onClick,
  disabled,
  fixedWidth,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  fixedWidth?: number
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      ...buttonBase,
      opacity: disabled ? 0.4 : 1,
      cursor: disabled ? "not-allowed" : "pointer",
      width: fixedWidth,
    }}
  >
    {children}
  </button>
)

const Pill = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      padding: "6px 10px",
      borderRadius: 999,
      background: "#0f172a",
      border: "1px solid #1f2937",
      color: "#cbd5e1",
      fontSize: 12,
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      minWidth: 120,
      justifyContent: "space-between",
    }}
  >
    {children}
  </div>
)

export const TransportControls = () => {
  const currentFrame = useGlobalCurrentFrame()
  const setCurrentFrame = useSetGlobalCurrentFrame()
  const clips = useTimelineClips()
  const fps = PROJECT_SETTINGS.fps
  const [loop, setLoop] = useState(true)
  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number | null>(null)
  const playingRef = useRef(false)
  const frameRef = useRef(currentFrame)
  const frameFloatRef = useRef<number>(currentFrame)

  const isPlaying = useIsPlaying()
  const setIsPlaying = useSetIsPlaying()

  frameRef.current = currentFrame
  frameFloatRef.current = currentFrame

  const durationFrames = useMemo(() => {
    const maxClipEnd = clips.reduce((max, clip) => Math.max(max, clip.end + 1), 0)
    return Math.max(Math.round(fps * 5), maxClipEnd, currentFrame + 1)
  }, [clips, fps, currentFrame])

  const stopPlayback = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    lastTimeRef.current = null
    playingRef.current = false
    setIsPlaying(false)
  }, [setIsPlaying])

  const tick = useCallback((timestamp: number) => {
    if (!playingRef.current) return
    const last = lastTimeRef.current ?? timestamp
    const deltaMs = timestamp - last
    const advance = (deltaMs / 1000) * fps
    const baseFloat = frameFloatRef.current
    const nextFloat = baseFloat + advance
    const nextInt = Math.floor(nextFloat)
    lastTimeRef.current = timestamp

    const endFrame = durationFrames - 1
    if (nextFloat > endFrame) {
      if (loop) {
        frameRef.current = 0
        frameFloatRef.current = 0
        setCurrentFrame(0)
        rafRef.current = requestAnimationFrame(tick)
      } else {
        frameRef.current = endFrame
        frameFloatRef.current = endFrame
        setCurrentFrame(endFrame)
        stopPlayback()
      }
      return
    }

    frameFloatRef.current = nextFloat
    if (nextInt !== frameRef.current) {
      frameRef.current = nextInt
      setCurrentFrame(nextInt)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [durationFrames, fps, loop, setCurrentFrame, stopPlayback])

  const togglePlay = useCallback(() => {
    if (playingRef.current) {
      stopPlayback()
      return
    }
    playingRef.current = true
    setIsPlaying(true)
    lastTimeRef.current = null
    rafRef.current = requestAnimationFrame(tick)
  }, [stopPlayback, tick])

  useEffect(() => {
    if (!isPlaying && playingRef.current) {
      stopPlayback()
    }
  }, [isPlaying, stopPlayback])

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const step = useCallback(
    (delta: number) => {
      stopPlayback()
      const target = Math.max(0, frameRef.current + delta)
      frameRef.current = target
      frameFloatRef.current = target
      setCurrentFrame(target)
    },
    [setCurrentFrame, stopPlayback],
  )

  const jumpToStart = useCallback(() => {
    stopPlayback()
    setCurrentFrame(0)
    frameRef.current = 0
    frameFloatRef.current = 0
  }, [setCurrentFrame, stopPlayback])

  const jumpToEnd = useCallback(() => {
    stopPlayback()
    const target = Math.max(0, durationFrames - 1)
    frameRef.current = target
    frameFloatRef.current = target
    setCurrentFrame(target)
  }, [durationFrames, setCurrentFrame, stopPlayback])

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "#0b1221",
        padding: 10,
        borderRadius: 10,
        border: "1px solid #1f2a3c",
        boxShadow: "0 10px 26px rgba(0,0,0,0.35)",
      }}
    >
      <Button onClick={jumpToStart}><span style={iconStyle}>⏮</span></Button>
      <Button onClick={() => step(-1)}><span style={iconStyle}>&lt;</span></Button>
      <Button onClick={togglePlay} fixedWidth={104}>
        <span style={iconStyle}>{isPlaying ? "⏸ " : "▶"}</span>
        <span style={{ fontWeight: 600, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" }}>
          {isPlaying ? "Pause" : "Play "}
        </span>
      </Button>
      <Button onClick={() => step(1)}><span style={iconStyle}>&gt;</span></Button>
      <Button onClick={jumpToEnd}><span style={iconStyle}>⏭</span></Button>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #1f2a3c",
            background: "#0f172a",
            color: "#cbd5e1",
            fontSize: 12,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => setLoop(e.target.checked)}
            style={{ accentColor: "#5bd5ff", width: 14, height: 14, cursor: "pointer" }}
          />
          Loop
        </label>
        <Pill>
          <span>{currentFrame}f</span>
          <span style={{ opacity: 0.7 }}>|</span>
          <span>{(currentFrame / fps).toFixed(2)}s</span>
        </Pill>
      </div>
    </div>
  )
}
