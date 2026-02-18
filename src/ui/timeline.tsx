import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { TimelineClip } from "../lib/timeline"
import { useTimelineClips, useClipVisibilityState } from "../lib/timeline"
import { useGlobalCurrentFrame, useSetGlobalCurrentFrame } from "../lib/frame"
import { PROJECT_SETTINGS } from "../../project/project"
import { TransportControls } from "./transport"
import { useIsPlaying, useSetIsPlaying } from "../lib/studio-state"
import { useAudioSegments } from "../lib/audio-plan"
import { AudioWaveformSegment } from "./audio-waveform"
import { isPerfDebugEnabled, logPerfSpike } from "../lib/perf-debug"

type PositionedClip = TimelineClip & { trackIndex: number }
type ClipWaveformSegment = {
  path: string
  startOffsetFrames: number
  durationFrames: number
  sourceStartFrame: number
}
type TimelineClipItemProps = {
  clip: PositionedClip
  label: string
  visible: boolean
  activeFrame: number | null
  waveformSegments: ClipWaveformSegment[]
  pxPerFrame: number
  laneHeight: number
  laneGap: number
  formatSeconds: (frame: number) => string
}

const clipGradients = [
  ["#2563eb", "#22d3ee"],
  ["#8b5cf6", "#a855f7"],
  ["#10b981", "#34d399"],
  ["#f59e0b", "#fbbf24"],
  ["#ef4444", "#f87171"],
  ["#14b8a6", "#2dd4bf"],
]

const stackClipsIntoTracks = (clips: TimelineClip[]): PositionedClip[] => {
  const sorted = [...clips].sort((a, b) => a.start - b.start || a.end - b.end)
  const trackEndFrames: number[] = []
  const laneTrack = new Map<string, number>()

  return sorted.map((clip) => {
    const clipEndExclusive = clip.end + 1

    let trackIndex: number | null = null
    if (clip.laneId && laneTrack.has(clip.laneId)) {
      const laneIdx = laneTrack.get(clip.laneId)!
      if (trackEndFrames[laneIdx] <= clip.start) {
        trackIndex = laneIdx
      }
    }

    if (trackIndex === null) {
      const available = trackEndFrames.findIndex((end) => end <= clip.start)
      trackIndex = available === -1 ? trackEndFrames.length : available
    }

    trackEndFrames[trackIndex] = clipEndExclusive

    if (clip.laneId && !laneTrack.has(clip.laneId)) {
      laneTrack.set(clip.laneId, trackIndex)
    }

    return { ...clip, trackIndex }
  })
}

let TIMELINE_ALL_FRAMES = 0
const EMPTY_WAVEFORM_SEGMENTS: ClipWaveformSegment[] = []
const EMPTY_ACTIVE_FRAMES: ReadonlyMap<string, number> = new Map()

const TimelineClipItem = memo(
  ({
    clip,
    label,
    visible,
    activeFrame,
    waveformSegments,
    pxPerFrame,
    laneHeight,
    laneGap,
    formatSeconds,
  }: TimelineClipItemProps) => {
    const left = clip.start * pxPerFrame
    const width = Math.max(0, (clip.end - clip.start + 1) * pxPerFrame)
    const depth = clip.depth ?? 0
    const [c1, c2] = clipGradients[depth % clipGradients.length]

    return (
      <div
        style={{
          position: "absolute",
          top: clip.trackIndex * (laneHeight + laneGap) + 4,
          left,
          width,
          height: laneHeight - 8,
          background: visible ? `linear-gradient(90deg, ${c1}, ${c2})` : "linear-gradient(90deg, #1f2937, #0f172a)",
          color: visible ? "#0b1221" : "#94a3b8",
          borderRadius: 4,
          padding: "4px 8px",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 8,
          boxShadow: visible ? "0 6px 18px rgba(0,0,0,0.25)" : "0 4px 12px rgba(0,0,0,0.2)",
          overflow: "hidden",
          opacity: visible ? 1 : 0.35,
        }}
      >
        {waveformSegments.length > 0 ? (
          <div
            style={{
              position: "absolute",
              inset: "2px 4px",
              opacity: visible ? 0.9 : 0.35,
              pointerEvents: "none",
              zIndex: 1,
            }}
          >
            {waveformSegments.map((segment, segIndex) => (
              <AudioWaveformSegment
                key={`${clip.id}-${segIndex}-${segment.path}`}
                path={segment.path}
                startOffsetFrames={segment.startOffsetFrames}
                durationFrames={segment.durationFrames}
                sourceStartFrame={segment.sourceStartFrame}
                pxPerFrame={pxPerFrame}
                height={laneHeight - 12}
                color={visible ? "rgba(15,23,42,0.8)" : "rgba(148,163,184,0.6)"}
                opacity={visible ? 0.55 : 0.25}
              />
            ))}
          </div>
        ) : null}

        <span style={{ fontWeight: 600, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", position: "relative", zIndex: 2 }}>{label}</span>
        <span style={{ fontSize: 12, opacity: 0.8, position: "relative", zIndex: 2 }}>
          {formatSeconds(clip.start)}s - {formatSeconds(clip.end)}s
        </span>
        {activeFrame != null ? (
          <span
            style={{
              marginLeft: "auto",
              padding: "2px 6px",
              borderRadius: 6,
              background: visible ? "rgba(15,23,42,0.7)" : "rgba(15,23,42,0.4)",
              color: visible ? "#f8fafc" : "#cbd5e1",
              border: "1px solid #1f2937",
              width: 20,
              textAlign: "right",
              fontSize: 11,
              lineHeight: 1.3,
              whiteSpace: "nowrap",
              position: "relative",
              zIndex: 2,
            }}
          >
            {activeFrame}f
          </span>
        ) : null}
      </div>
    )
  },
)

export function getTimeLineAllFrames(): number {
  return TIMELINE_ALL_FRAMES
}

export const TimelineUI = () => {
  const renderStartMs = performance.now()
  const clips = useTimelineClips()
  const { hiddenMap } = useClipVisibilityState()
  const audioSegments = useAudioSegments()
  const currentFrame = useGlobalCurrentFrame()
  const setCurrentFrame = useSetGlobalCurrentFrame()
  const projectSettings = PROJECT_SETTINGS
  const { fps } = projectSettings
  const [zoom, setZoom] = useState(1)
  const waveformAutoLimitFrames = Math.max(1, Math.round(fps * 60))

  const placedClips = useMemo(() => stackClipsIntoTracks(clips), [clips])
  const trackCount = Math.max(1, placedClips.reduce((max, clip) => Math.max(max, clip.trackIndex + 1), 0))
  const audioSegmentsByClip = useMemo(() => {
    const map = new Map<string, ClipWaveformSegment[]>()
    for (const clip of placedClips) {
      const segments: ClipWaveformSegment[] = []
      for (const segment of audioSegments) {
        if (segment.clipId && segment.clipId !== clip.id) {
          continue
        }
        const autoAllowed = segment.durationFrames < waveformAutoLimitFrames
        const shouldShowWaveform = segment.showWaveform ?? autoAllowed
        if (!shouldShowWaveform) {
          continue
        }
        const segStart = segment.projectStartFrame
        const segEnd = segStart + segment.durationFrames - 1
        if (segEnd < clip.start || segStart > clip.end) {
          continue
        }

        const overlapStart = Math.max(clip.start, segStart)
        const overlapEnd = Math.min(clip.end, segEnd)
        const durationFrames = Math.max(0, overlapEnd - overlapStart + 1)
        if (durationFrames <= 0) continue

        const sourceOffset = segment.sourceStartFrame + Math.max(0, overlapStart - segStart)
        segments.push({
          path: segment.source.path,
          startOffsetFrames: Math.max(0, overlapStart - clip.start),
          durationFrames,
          sourceStartFrame: sourceOffset,
        })
      }
      if (segments.length > 0) {
        map.set(clip.id, segments)
      }
    }
    return map
  }, [audioSegments, placedClips, waveformAutoLimitFrames])
  const maxClipEndExclusive = useMemo(
    () => placedClips.reduce((max, clip) => Math.max(max, clip.end + 1), 0),
    [placedClips],
  )
  const clipMap = useMemo(() => {
    const map = new Map<string, PositionedClip>()
    placedClips.forEach((c) => map.set(c.id, c))
    return map
  }, [placedClips])
  const visibleByClip = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const clip of placedClips) {
      let cursor: string | null | undefined = clip.id
      let visible = true
      while (cursor) {
        if (hiddenMap[cursor]) {
          visible = false
          break
        }
        cursor = clipMap.get(cursor)?.parentId ?? null
      }
      map.set(clip.id, visible)
    }
    return map
  }, [clipMap, hiddenMap, placedClips])
  const clipOrder = useMemo(() => {
    const map = new Map<string, number>()
    placedClips.forEach((clip, index) => {
      map.set(clip.id, index)
    })
    return map
  }, [placedClips])

  const durationInFrames = useMemo(() => {
    TIMELINE_ALL_FRAMES = Math.max(1, maxClipEndExclusive, currentFrame + 1)
    return TIMELINE_ALL_FRAMES
  }, [currentFrame, maxClipEndExclusive])

  const sliderMax = Math.max(0, durationInFrames - 1)
  const safeCurrentFrame = Math.min(currentFrame, sliderMax)

  const basePxPerFrame = 4
  const pxPerFrame = basePxPerFrame * zoom
  const contentWidth = Math.max(600, durationInFrames * pxPerFrame)
  const playheadPositionPx = safeCurrentFrame * pxPerFrame

  const scrollerRef = useRef<HTMLDivElement>(null)
  const scrubRef = useRef<HTMLDivElement>(null)
  const scrollMetricsRef = useRef({ left: 0, viewport: 0 })
  const scrubRafRef = useRef<number | null>(null)
  const pendingScrubClientXRef = useRef<number | null>(null)
  const lastScrubbedFrameRef = useRef(currentFrame)

  const setIsPlaying = useSetIsPlaying()

  useEffect(() => {
    lastScrubbedFrameRef.current = currentFrame
  }, [currentFrame])

  const updateFromClientX = useCallback(
    (clientX: number) => {
      const scroller = scrollerRef.current
      if (!scroller) return
      const rect = scroller.getBoundingClientRect()
      const x = clientX - rect.left + scroller.scrollLeft
      const clampedPx = Math.max(0, Math.min(contentWidth, x))
      const frame = Math.min(Math.round(clampedPx / pxPerFrame), sliderMax)
      if (frame !== lastScrubbedFrameRef.current) {
        lastScrubbedFrameRef.current = frame
        setCurrentFrame(frame)
      }
      setIsPlaying(false)
    },
    [contentWidth, pxPerFrame, setCurrentFrame, setIsPlaying, sliderMax],
  )

  const flushPendingScrub = useCallback(() => {
    const clientX = pendingScrubClientXRef.current
    pendingScrubClientXRef.current = null
    if (clientX == null) return
    updateFromClientX(clientX)
  }, [updateFromClientX])

  const scheduleScrub = useCallback(
    (clientX: number) => {
      pendingScrubClientXRef.current = clientX
      if (scrubRafRef.current != null) return
      scrubRafRef.current = requestAnimationFrame(() => {
        scrubRafRef.current = null
        flushPendingScrub()
      })
    },
    [flushPendingScrub],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!scrubRef.current) return
      scrubRef.current.setPointerCapture(event.pointerId)
      updateFromClientX(event.clientX)

      const onMove = (e: PointerEvent) => scheduleScrub(e.clientX)
      const onUp = (e: PointerEvent) => {
        pendingScrubClientXRef.current = e.clientX
        if (scrubRafRef.current != null) {
          cancelAnimationFrame(scrubRafRef.current)
          scrubRafRef.current = null
        }
        flushPendingScrub()
        scrubRef.current?.releasePointerCapture(event.pointerId)
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
    },
    [flushPendingScrub, scheduleScrub, updateFromClientX],
  )

  useEffect(() => {
    return () => {
      if (scrubRafRef.current != null) {
        cancelAnimationFrame(scrubRafRef.current)
      }
    }
  }, [])

  const isPlaying = useIsPlaying()

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    const updateMetrics = () => {
      scrollMetricsRef.current = {
        left: scroller.scrollLeft,
        viewport: scroller.clientWidth,
      }
    }

    updateMetrics()
    scroller.addEventListener("scroll", updateMetrics, { passive: true })
    const observer = new ResizeObserver(updateMetrics)
    observer.observe(scroller)
    return () => {
      scroller.removeEventListener("scroll", updateMetrics)
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const startMs = performance.now()
    const scroller = scrollerRef.current
    if (!scroller) return
    const { left, viewport } = scrollMetricsRef.current
    if (viewport <= 0) return
    const margin = Math.min(200, viewport / 3)
    const right = left + viewport
    const pos = playheadPositionPx

    if (isPlaying) {
      let target = left
      if (pos < left + margin) {
        target = Math.max(0, pos - margin)
      } else if (pos > right - margin) {
        target = Math.max(
          0,
          Math.min(contentWidth - viewport, pos - (viewport - margin)),
        )
      }
      if (Math.abs(target - left) > 0.5) {
        scroller.scrollLeft = target
        scrollMetricsRef.current.left = target
      }
      logPerfSpike("timeline.autoscroll", performance.now() - startMs, {
        mode: "playing",
        left,
        pos,
        viewport,
      })
      return
    }

    if (pos < left + margin || pos > right - margin) {
      const target = Math.max(
        0,
        Math.min(contentWidth - viewport, pos - viewport / 2),
      )
      if (Math.abs(target - left) > 1) {
        scroller.scrollTo({ left: target, behavior: "smooth" })
      }
    }
    logPerfSpike("timeline.autoscroll", performance.now() - startMs, {
      mode: "paused",
      left,
      pos,
      viewport,
    })
  }, [isPlaying, playheadPositionPx, contentWidth])

  useLayoutEffect(() => {
    logPerfSpike("timeline.render", performance.now() - renderStartMs, {
      clips: placedClips.length,
      tracks: trackCount,
      frame: safeCurrentFrame,
      zoom,
    })
  })

  useEffect(() => {
    if (!isPerfDebugEnabled()) return
    if (typeof PerformanceObserver === "undefined") return
    let observer: PerformanceObserver | null = null
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          logPerfSpike("browser.longtask", entry.duration, {
            name: entry.name,
            startTime: Math.round(entry.startTime),
          })
        }
      })
      observer.observe({ entryTypes: ["longtask"] as any })
    } catch {
      // ignore unsupported observers
    }

    return () => {
      observer?.disconnect()
    }
  }, [])

  const formatSeconds = useCallback(
    (frame: number) => (frame / fps).toFixed(2),
    [fps],
  )

  const laneHeight = 28
  const laneGap = 6
  const scrubHeight = 16
  const scrubGap = 8
  const rulerHeight = 24
  const rulerGap = 8
  const pxPerSecond = pxPerFrame * fps
  const ticks = useMemo(() => {
    const targetSpacingPx = 120
    const candidateSeconds = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
    const intervalSeconds = candidateSeconds.find((s) => s * pxPerSecond >= targetSpacingPx) ?? candidateSeconds[candidateSeconds.length - 1]
    const intervalFrames = Math.max(1, Math.round(intervalSeconds * fps))
    const result: { frame: number; px: number; label: string }[] = []
    for (let frame = 0; frame <= durationInFrames; frame += intervalFrames) {
      const seconds = frame / fps
      result.push({
        frame,
        px: frame * pxPerFrame,
        label: seconds >= 60 ? `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}` : `${seconds.toFixed(1)}s`,
      })
    }
    return result
  }, [durationInFrames, fps, pxPerFrame, pxPerSecond])
  const activeFrameByClip = useMemo(() => {
    if (isPlaying) return EMPTY_ACTIVE_FRAMES
    const map = new Map<string, number>()
    for (const clip of placedClips) {
      if (safeCurrentFrame >= clip.start && safeCurrentFrame <= clip.end) {
        map.set(clip.id, safeCurrentFrame - clip.start)
      }
    }
    return map
  }, [isPlaying, placedClips, safeCurrentFrame])
  const rulerTickNodes = useMemo(
    () =>
      ticks.map((tick) => (
        <div key={tick.frame} style={{ position: "absolute", left: tick.px, top: 0, width: 1, height: rulerHeight, background: "#334155" }}>
          <div
            style={{
              position: "absolute",
              top: 4,
              left: 0,
              transform: "translateX(-50%)",
              fontSize: 10,
              color: "#cbd5e1",
              whiteSpace: "nowrap",
              background: "rgba(15,15,18,0.8)",
              padding: "0 4px",
              borderRadius: 3,
              border: "1px solid #1f2937",
            }}
          >
            {tick.label}
          </div>
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              width: 1,
              height: 8,
              background: "#475569",
            }}
          />
        </div>
      )),
    [rulerHeight, ticks],
  )
  const laneBackgroundNodes = useMemo(
    () =>
      [...Array(trackCount)].map((_, index) => (
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
      )),
    [laneGap, laneHeight, trackCount],
  )
  const clipItemNodes = useMemo(
    () =>
      placedClips.map((clip) => (
        <TimelineClipItem
          key={clip.id}
          clip={clip}
          label={clip.label ?? `Clip ${(clipOrder.get(clip.id) ?? 0) + 1}`}
          visible={visibleByClip.get(clip.id) ?? true}
          activeFrame={activeFrameByClip.get(clip.id) ?? null}
          waveformSegments={audioSegmentsByClip.get(clip.id) ?? EMPTY_WAVEFORM_SEGMENTS}
          pxPerFrame={pxPerFrame}
          laneHeight={laneHeight}
          laneGap={laneGap}
          formatSeconds={formatSeconds}
        />
      )),
    [
      activeFrameByClip,
      audioSegmentsByClip,
      clipOrder,
      formatSeconds,
      laneGap,
      laneHeight,
      pxPerFrame,
      placedClips,
      visibleByClip,
    ],
  )
  const trackAreaHeight = trackCount * laneHeight + (trackCount - 1) * laneGap + 16
  const trackTop = scrubHeight + scrubGap + rulerHeight + rulerGap
  const containerHeight = trackTop + trackAreaHeight
  const scrollbarStyles = `
  .fs-scroll {
    scrollbar-color: #334155 #0f172a;
  }
  .fs-scroll::-webkit-scrollbar {
    height: 8px;
    width: 8px;
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
    <div style={{ background: "#0f0f12", border: "1px solid #27272a", borderRadius: 8, padding: 12, color: "#e5e7eb", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12, minHeight: 0, width: "100%", maxWidth: "100%", minWidth: 0, overflow: "hidden" }}>
      <style>{scrollbarStyles}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 220px", minWidth: 180, maxWidth: 240 }}>
          <label style={{ fontSize: 12, color: "#cbd5e1", minWidth: 46 }}>Scale</label>
          <input
            type="range"
            min={0.05}
            max={4}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            style={{ flex: "1 1 auto", minWidth: 100 }}
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

      <div style={{ flex: 1, minHeight: 0, display: "flex", minWidth: 0 }}>
        <div
          ref={scrollerRef}
          className="fs-scroll"
          style={{
            background: "#111",
            borderRadius: 6,
            border: "1px solid #27272a",
            padding: "8px 8px 12px",
            overflow: "auto",
            flex: "1 1 0",
            minHeight: 0,
            minWidth: 0,
            width: "100%",
            height: "100%",
            boxSizing: "border-box",
            display: "block",
            maxWidth: "100%",
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              right: 8,
              bottom: 12,
              width: contentWidth,
              minWidth: contentWidth,
              height: containerHeight,
            }}
          >
            <div
              style={{
                position: "sticky",
                top: 0,
                left: 0,
                width: contentWidth,
                height: scrubHeight,
                marginBottom: scrubGap,
                cursor: "ew-resize",
                userSelect: "none",
              }}
              ref={scrubRef}
              onPointerDown={handlePointerDown}
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
                position: "absolute",
                top: scrubHeight + scrubGap,
                left: 0,
                right: 0,
                height: rulerHeight,
                background: "#0f172a",
                borderRadius: 4,
                border: "1px solid #1f2937",
                boxSizing: "border-box",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: rulerHeight - 1,
                  left: 0,
                  right: 0,
                  height: 1,
                  background: "#1f2937",
                }}
              />
              {rulerTickNodes}
            </div>

            <div
              style={{
                position: "absolute",
                top: trackTop,
                left: 0,
                width: contentWidth,
                height: trackAreaHeight,
                background: "#18181b",
                borderRadius: 6,
                border: "1px solid #27272a",
                overflow: "hidden",
              }}
            >
              {laneBackgroundNodes}

              {clipItemNodes}

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
    </div>
  )
}
