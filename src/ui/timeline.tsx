import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { TimelineClip } from "../lib/timeline"
import { useTimelineClips } from "../lib/timeline"
import { useCurrentFrame, useSetCurrentFrame } from "../lib/frame"
import { PROJECT_SETTINGS } from "../../project/project"
import { TransportControls } from "./transport"

type PositionedClip = TimelineClip & { trackIndex: number }

const stackClipsIntoTracks = (clips: TimelineClip[]): PositionedClip[] => {
  const sorted = [...clips].sort((a, b) => a.start - b.start || a.end - b.end)
  const trackEndFrames: number[] = []

  return sorted.map((clip) => {
    const trackIndex = trackEndFrames.findIndex((end) => end <= clip.start)
    if (trackIndex === -1) {
      trackEndFrames.push(clip.end)
      return { ...clip, trackIndex: trackEndFrames.length - 1 }
    }
    trackEndFrames[trackIndex] = clip.end
    return { ...clip, trackIndex }
  })
}

export const TimelineUI = () => {
  const clips = useTimelineClips()
  const currentFrame = useCurrentFrame()
  const setCurrentFrame = useSetCurrentFrame()
  const projectSettings = PROJECT_SETTINGS
  const { fps } = projectSettings
  const [zoom, setZoom] = useState(0.5)

  const placedClips = useMemo(() => stackClipsIntoTracks(clips), [clips])
  const trackCount = Math.max(1, placedClips.reduce((max, clip) => Math.max(max, clip.trackIndex + 1), 0))

  const durationInFrames = useMemo(() => {
    const maxClipEnd = placedClips.reduce((max, clip) => Math.max(max, clip.end), 0)
    return Math.max(1, Math.round(fps * 5), maxClipEnd, currentFrame + 1)
  }, [placedClips, fps, currentFrame])

  const sliderMax = Math.max(0, durationInFrames - 1)
  const safeCurrentFrame = Math.min(currentFrame, sliderMax)

  const basePxPerFrame = 4
  const pxPerFrame = basePxPerFrame * zoom
  const contentWidth = Math.max(600, durationInFrames * pxPerFrame)
  const playheadPositionPx = safeCurrentFrame * pxPerFrame

  const scrollerRef = useRef<HTMLDivElement>(null)
  const scrubRef = useRef<HTMLDivElement>(null)

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const scroller = scrollerRef.current
      if (!scroller) return
      const rect = scroller.getBoundingClientRect()
      const x = clientX - rect.left + scroller.scrollLeft
      const clampedPx = Math.max(0, Math.min(contentWidth, x))
      const frame = Math.round(clampedPx / pxPerFrame)
      setCurrentFrame(Math.min(frame, sliderMax))
    },
    [contentWidth, pxPerFrame, setCurrentFrame, sliderMax],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!scrubRef.current) return
      scrubRef.current.setPointerCapture(event.pointerId)
      updateFromClientX(event.clientX)

      const onMove = (e: PointerEvent) => updateFromClientX(e.clientX)
      const onUp = (e: PointerEvent) => {
        updateFromClientX(e.clientX)
        scrubRef.current?.releasePointerCapture(event.pointerId)
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
    },
    [updateFromClientX],
  )

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const viewport = scroller.clientWidth
    const margin = Math.min(200, viewport / 3)
    const left = scroller.scrollLeft
    const right = left + viewport
    const pos = playheadPositionPx

    if (pos < left + margin || pos > right - margin) {
      const target = Math.max(0, Math.min(contentWidth - viewport, pos - viewport / 2))
      scroller.scrollTo({ left: target, behavior: "smooth" })
    }
  }, [playheadPositionPx, contentWidth])

  const formatSeconds = useCallback(
    (frame: number) => (frame / fps).toFixed(2),
    [fps],
  )

  const laneHeight = 28
  const laneGap = 6
  const scrollbarStyles = `
  .fs-scroll {
    scrollbar-color: #334155 #0f172a;
  }
  .fs-scroll::-webkit-scrollbar {
    height: 10px;
  }
  .fs-scroll::-webkit-scrollbar-track {
    background: #0f172a;
    border-radius: 999px;
  }
  .fs-scroll::-webkit-scrollbar-thumb {
    background: linear-gradient(90deg, #1f2937, #334155);
    border-radius: 999px;
    border: 2px solid #0f172a;
  }
  .fs-scroll::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(90deg, #2b384c, #4b5563);
  }
  `

  return (
    <div style={{ background: "#0f0f12", border: "1px solid #27272a", borderRadius: 8, padding: 12, color: "#e5e7eb" }}>
      <style>{scrollbarStyles}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "1 1 300px", minWidth: 260 }}>
          <label style={{ fontSize: 12, color: "#cbd5e1", minWidth: 46 }}>Scale</label>
          <input
            type="range"
            min={0.05}
            max={4}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            style={{ flex: "1 1 auto" }}
          />
          <div style={{ width: 64, fontSize: 12, textAlign: "right", color: "#e5e7eb" }}>{Math.round(zoom * 100)}%</div>
        </div>

        <div style={{ flex: "0 0 auto" }}>
          <TransportControls />
        </div>

        <div style={{ fontSize: 12, lineHeight: 1.3, minWidth: 140, textAlign: "right", marginLeft: "auto" }}>
          <div>Frame: {safeCurrentFrame}</div>
          <div>Time: {formatSeconds(safeCurrentFrame)}s</div>
          <div>Duration: {formatSeconds(durationInFrames)}s</div>
        </div>
      </div>

      <div ref={scrollerRef} className="fs-scroll" style={{ background: "#111", borderRadius: 6, border: "1px solid #27272a", padding: "8px 8px 12px", overflowX: "auto" }}>
        <div style={{ minWidth: contentWidth }}>
          <div
            ref={scrubRef}
            onPointerDown={handlePointerDown}
            style={{
              position: "relative",
              width: contentWidth,
              height: 16,
              marginBottom: 0,
              cursor: "ew-resize",
              userSelect: "none",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 8,
                left: 0,
                right: 0,
                height: 4,
                borderRadius: 999,
                background: "linear-gradient(90deg, #334155, #1e293b)",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 2,
                left: playheadPositionPx + 1.5,
                width: 14,
                height: 14,
                background: "#f59e0b",
                borderRadius: 4,
                boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
                transform: "translate(-50%, 0)",
                pointerEvents: "none",
              }}
            />
          </div>

          <div
            style={{
              position: "relative",
              width: contentWidth,
              height: trackCount * laneHeight + (trackCount - 1) * laneGap + 16,
              background: "#18181b",
              borderRadius: 6,
              border: "1px solid #27272a",
              overflow: "hidden",
            }}
          >
            {[...Array(trackCount)].map((_, index) => (
              <div
                key={index}
                style={{
                  position: "absolute",
                  top: index * (laneHeight + laneGap),
                  left: 0,
                  right: 0,
                  height: laneHeight,
                  borderBottom: index === trackCount - 1 ? "none" : "1px dashed #2f3033",
                }}
              />
            ))}

            {placedClips.map((clip, idx) => {
              const left = clip.start * pxPerFrame
              const width = Math.max(0, (clip.end - clip.start) * pxPerFrame)
              const label = clip.label ?? `Clip ${idx + 1}`

              return (
                <div
                  key={clip.id}
                  style={{
                    position: "absolute",
                    top: clip.trackIndex * (laneHeight + laneGap) + 4,
                    left,
                    width,
                    height: laneHeight - 8,
                    background: "linear-gradient(90deg, #2563eb, #22d3ee)",
                    color: "#0b1221",
                    borderRadius: 4,
                    padding: "4px 8px",
                    boxSizing: "border-box",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
                    overflow: "hidden",
                  }}
                >
                  <span style={{ fontWeight: 600, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>{label}</span>
                  <span style={{ fontSize: 12, opacity: 0.8 }}>
                    {formatSeconds(clip.start)}s – {formatSeconds(clip.end)}s
                  </span>
                </div>
              )
            })}

            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: playheadPositionPx,
                width: 2,
                background: "#f59e0b",
                pointerEvents: "none",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
