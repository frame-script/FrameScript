import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useGlobalCurrentFrame, useSetGlobalCurrentFrame } from "../lib/frame"
import { PROJECT_SETTINGS } from "../../project/project"
import { useTimelineClips } from "../lib/timeline"
import { useIsPlaying, useSetIsPlaying } from "../lib/studio-state"
import { logPerfSpike } from "../lib/perf-debug"

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
  const playbackStartTimeRef = useRef<number | null>(null)
  const playbackStartFrameRef = useRef(currentFrame)
  const lastSetFrameRef = useRef(currentFrame)
  const queuedFrameRef = useRef<number | null>(null)
  const renderedFrameRef = useRef(currentFrame)
  const playingRef = useRef(false)
  const frameRef = useRef(currentFrame)
  const frameFloatRef = useRef<number>(currentFrame)

  const isPlaying = useIsPlaying()
  const setIsPlaying = useSetIsPlaying()

  useEffect(() => {
    renderedFrameRef.current = currentFrame
    if (!playingRef.current) {
      frameRef.current = currentFrame
      frameFloatRef.current = currentFrame
      playbackStartFrameRef.current = currentFrame
      lastSetFrameRef.current = currentFrame
      return
    }

    const drift = currentFrame - lastSetFrameRef.current
    if (Math.abs(drift) > 2) {
      frameRef.current = currentFrame
      frameFloatRef.current = currentFrame
      playbackStartFrameRef.current = currentFrame
      playbackStartTimeRef.current = null
      lastSetFrameRef.current = currentFrame
    }
  }, [currentFrame])

  const maxClipEndExclusive = useMemo(
    () => clips.reduce((max, clip) => Math.max(max, clip.end + 1), 0),
    [clips],
  )

  const durationFrames = useMemo(() => {
    return Math.max(1, maxClipEndExclusive, currentFrame + 1)
  }, [currentFrame, maxClipEndExclusive])

  const stopPlayback = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    playbackStartTimeRef.current = null
    queuedFrameRef.current = null
    playingRef.current = false
    setIsPlaying(false)
  }, [setIsPlaying])

  const scheduleFrameCommit = useCallback(
    (nextFrame: number) => {
      const startMs = performance.now()
      queuedFrameRef.current = nextFrame
      if (renderedFrameRef.current !== lastSetFrameRef.current) {
        logPerfSpike("transport.scheduleFrameCommit", performance.now() - startMs, {
          reason: "waiting_render",
          nextFrame,
          rendered: renderedFrameRef.current,
          lastSet: lastSetFrameRef.current,
        })
        return
      }
      const queued = queuedFrameRef.current
      if (queued == null) return
      queuedFrameRef.current = null
      if (queued !== frameRef.current) {
        frameRef.current = queued
        lastSetFrameRef.current = queued
        setCurrentFrame(queued)
      }
      logPerfSpike("transport.scheduleFrameCommit", performance.now() - startMs, {
        reason: "commit",
        nextFrame: queued,
      })
    },
    [setCurrentFrame],
  )

  const tick = useCallback((timestamp: number) => {
    const startMs = performance.now()
    const finish = (reason: string) => {
      logPerfSpike("transport.tick", performance.now() - startMs, {
        reason,
        frame: frameRef.current,
        durationFrames,
      })
    }
    if (!playingRef.current) return
    if (playbackStartTimeRef.current == null) {
      playbackStartTimeRef.current = timestamp
      playbackStartFrameRef.current = frameRef.current
    }
    const elapsedMs = timestamp - playbackStartTimeRef.current
    const nextFloat = playbackStartFrameRef.current + (elapsedMs / 1000) * fps
    const nextInt = Math.floor(nextFloat)

    const endFrame = durationFrames - 1
    if (nextFloat > endFrame) {
      if (loop) {
        playbackStartFrameRef.current = 0
        playbackStartTimeRef.current = timestamp
        scheduleFrameCommit(0)
        rafRef.current = requestAnimationFrame(tick)
      } else {
        scheduleFrameCommit(endFrame)
        stopPlayback()
      }
      finish("boundary")
      return
    }

    frameFloatRef.current = nextFloat
    if (nextInt !== frameRef.current) {
      scheduleFrameCommit(nextInt)
    }
    rafRef.current = requestAnimationFrame(tick)
    finish("normal")
  }, [durationFrames, fps, loop, scheduleFrameCommit, stopPlayback])

  const togglePlay = useCallback(() => {
    if (playingRef.current) {
      stopPlayback()
      return
    }
    playingRef.current = true
    setIsPlaying(true)
    frameRef.current = currentFrame
    frameFloatRef.current = currentFrame
    playbackStartFrameRef.current = currentFrame
    playbackStartTimeRef.current = null
    lastSetFrameRef.current = currentFrame
    queuedFrameRef.current = null
    rafRef.current = requestAnimationFrame(tick)
  }, [currentFrame, setIsPlaying, stopPlayback, tick])

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
    lastSetFrameRef.current = target
    queuedFrameRef.current = null
    setCurrentFrame(target)
  },
  [setCurrentFrame, stopPlayback],
  )

  const jumpToStart = useCallback(() => {
    stopPlayback()
    setCurrentFrame(0)
    frameRef.current = 0
    frameFloatRef.current = 0
    lastSetFrameRef.current = 0
    queuedFrameRef.current = null
  }, [setCurrentFrame, stopPlayback])

  const jumpToEnd = useCallback(() => {
    stopPlayback()
    const target = Math.max(0, durationFrames - 1)
    frameRef.current = target
    frameFloatRef.current = target
    lastSetFrameRef.current = target
    queuedFrameRef.current = null
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
