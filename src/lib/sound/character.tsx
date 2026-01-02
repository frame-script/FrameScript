import { useEffect, useMemo, useState, type CSSProperties } from "react"
import { PROJECT_SETTINGS } from "../../../project/project"
import { useGlobalCurrentFrame } from "../frame"
import { type AudioSegment, useAudioSegments } from "../audio-plan"
import { loadWaveformData, type WaveformData } from "../audio-waveform"
import { useTimelineClips } from "../timeline"

type CharacterProps = {
  mouthClosed: string
  mouthOpen: string
  threshold?: number
  clipLabel?: string
  style?: CSSProperties
  className?: string
  alt?: string
}

const DEFAULT_THRESHOLD = 0.1

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const useWaveformBank = (paths: string[]) => {
  const [bank, setBank] = useState<Map<string, WaveformData | null>>(new Map())

  const { key, list } = useMemo(() => {
    const unique = Array.from(new Set(paths.filter(Boolean))).sort()
    return { key: unique.join("\n"), list: unique }
  }, [paths])

  useEffect(() => {
    let alive = true
    for (const path of list) {
      void loadWaveformData(path).then((data) => {
        if (!alive) return
        setBank((prev) => {
          if (prev.get(path) === data) return prev
          const next = new Map(prev)
          next.set(path, data)
          return next
        })
      })
    }
    return () => {
      alive = false
    }
  }, [key, list])

  return bank
}

const resolveSegmentAmplitude = (
  segment: AudioSegment,
  waveform: WaveformData | null,
  currentFrame: number,
  fps: number,
) => {
  if (!waveform || waveform.peaks.length === 0 || waveform.durationSec <= 0) return 0
  const durationFrames = Math.max(0, segment.durationFrames)
  if (durationFrames <= 0) return 0

  const relativeFrame = currentFrame - segment.projectStartFrame
  if (relativeFrame < 0 || relativeFrame >= durationFrames) return 0

  const sourceFrame = Math.max(0, segment.sourceStartFrame + relativeFrame)
  const timeSec = Math.max(0, sourceFrame / fps)
  const ratio = clamp(timeSec / waveform.durationSec, 0, 1)
  const index = Math.min(
    waveform.peaks.length - 1,
    Math.max(0, Math.floor(ratio * waveform.peaks.length)),
  )

  let amplitude = waveform.peaks[index] ?? 0
  const volume = Number.isFinite(segment.volume) ? Math.max(0, segment.volume ?? 1) : 1
  amplitude *= volume

  const fadeInFrames = Math.max(0, segment.fadeInFrames ?? 0)
  if (fadeInFrames > 0) {
    amplitude *= clamp(relativeFrame / fadeInFrames, 0, 1)
  }

  const fadeOutFrames = Math.max(0, segment.fadeOutFrames ?? 0)
  if (fadeOutFrames > 0) {
    const fadeOutStart = Math.max(0, durationFrames - fadeOutFrames)
    if (relativeFrame >= fadeOutStart) {
      amplitude *= clamp((durationFrames - 1 - relativeFrame) / fadeOutFrames, 0, 1)
    }
  }

  return amplitude
}

export const Character = ({
  mouthClosed,
  mouthOpen,
  threshold = DEFAULT_THRESHOLD,
  clipLabel,
  style,
  className,
  alt,
}: CharacterProps) => {
  const currentFrame = useGlobalCurrentFrame()
  const clips = useTimelineClips()
  const audioSegments = useAudioSegments()
  const fps = PROJECT_SETTINGS.fps

  const relevantSegments = useMemo(() => {
    if (!clipLabel) return audioSegments
    const ids = new Set(
      clips.filter((clip) => clip.label === clipLabel).map((clip) => clip.id),
    )
    if (ids.size === 0) return []
    return audioSegments.filter((segment) => segment.clipId && ids.has(segment.clipId))
  }, [audioSegments, clipLabel, clips])

  const waveformPaths = useMemo(
    () => relevantSegments.map((segment) => segment.source.path),
    [relevantSegments],
  )
  const waveformBank = useWaveformBank(waveformPaths)

  const amplitude = useMemo(() => {
    let max = 0
    for (const segment of relevantSegments) {
      const waveform = waveformBank.get(segment.source.path) ?? null
      const value = resolveSegmentAmplitude(segment, waveform, currentFrame, fps)
      if (value > max) max = value
    }
    return max
  }, [currentFrame, fps, relevantSegments, waveformBank])

  const safeThreshold = Number.isFinite(threshold) ? Math.max(0, threshold) : DEFAULT_THRESHOLD
  const isSpeaking = amplitude >= safeThreshold

  return (
    <img
      src={isSpeaking ? mouthOpen : mouthClosed}
      alt={alt ?? "character"}
      className={className}
      style={{ display: "block", ...style }}
    />
  )
}
