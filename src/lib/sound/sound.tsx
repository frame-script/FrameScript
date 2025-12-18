import { useCallback, useEffect, useId, useMemo, useRef } from "react"
import { PROJECT_SETTINGS } from "../../../project/project"
import { useGlobalCurrentFrame } from "../frame"
import { useClipActive, useClipRange, useProvideClipDuration } from "../clip"
import { registerAudioSegmentGlobal, unregisterAudioSegmentGlobal } from "../audio-plan"
import { fetchAudioBuffer } from "../audio"
import { useIsPlaying, useIsRender } from "../studio-state"
import type { Trim } from "../trim"
import { resolveTrimFrames } from "../trim"

export type Sound = {
  path: string
}

export type SoundProps = {
  sound: Sound | string
  trim?: Trim
}

export const normalizeSound = (sound: Sound | string): Sound => {
  if (typeof sound === "string") return { path: sound }
  return sound
}

const buildMetaUrl = (sound: Sound) => {
  const url = new URL("http://localhost:3000/audio/meta")
  url.searchParams.set("path", sound.path)
  return url.toString()
}

const soundLengthCache = new Map<string, number>()
const MAX_REASONABLE_DURATION_MS = 1000 * 60 * 60 * 24 * 7 // 7 days

export const sound_length = (sound: Sound | string): number => {
  const resolved = normalizeSound(sound)

  if (soundLengthCache.has(resolved.path)) {
    return soundLengthCache.get(resolved.path)!
  }

  try {
    const xhr = new XMLHttpRequest()
    xhr.open("GET", buildMetaUrl(resolved), false) // 同期リクエストで初期ロード用途
    xhr.send()

    if (xhr.status >= 200 && xhr.status < 300) {
      const payload = JSON.parse(xhr.responseText) as { duration_ms?: number }
      const rawMs = typeof payload.duration_ms === "number" ? payload.duration_ms : 0
      if (!Number.isFinite(rawMs) || rawMs <= 0 || rawMs > MAX_REASONABLE_DURATION_MS) {
        return 0
      }
      const seconds = rawMs / 1000
      const frames = Math.round(seconds * PROJECT_SETTINGS.fps)
      if (frames > 0) {
        soundLengthCache.set(resolved.path, frames)
      }
      return frames
    }
  } catch (error) {
    console.error("sound_length(): failed to fetch metadata", error)
  }

  soundLengthCache.set(resolved.path, 0)
  return 0
}

export const Sound = ({ sound, trim }: SoundProps) => {
  const id = useId()
  const clipRange = useClipRange()
  const isActive = useClipActive()
  const isPlaying = useIsPlaying()
  const isRender = useIsRender()
  const globalFrame = useGlobalCurrentFrame()
  const resolvedSound = useMemo(() => normalizeSound(sound), [sound])
  const rawDurationFrames = useMemo(
    () => sound_length(resolvedSound),
    [resolvedSound],
  )
  const { trimStartFrames, trimEndFrames } = useMemo(
    () =>
      resolveTrimFrames({
        rawDurationFrames,
        trim,
      }),
    [rawDurationFrames, trim],
  )
  const durationFrames = Math.max(
    0,
    rawDurationFrames - trimStartFrames - trimEndFrames,
  )

  useProvideClipDuration(durationFrames)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const playingPathRef = useRef<string | null>(null)
  const prevFrameRef = useRef<number | null>(null)

  const stopPlayback = useCallback(() => {
    const src = sourceRef.current
    sourceRef.current = null
    playingPathRef.current = null
    if (src) {
      try {
        src.onended = null
        src.stop()
      } catch {
        // ignore
      }
      try {
        src.disconnect()
      } catch {
        // ignore
      }
    }
  }, [])

  const ensureAudioContext = useCallback(async () => {
    if (audioCtxRef.current) return audioCtxRef.current
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    const ctx = new Ctx()
    audioCtxRef.current = ctx
    const gain = ctx.createGain()
    gain.gain.value = 1
    gain.connect(ctx.destination)
    gainRef.current = gain
    try {
      await ctx.resume()
    } catch {
      // may require user gesture; retry on play
    }
    return ctx
  }, [])

  const startPlaybackAt = useCallback(
    async (projectFrame: number) => {
      if (!clipRange) return
      const fps = PROJECT_SETTINGS.fps
      if (fps <= 0) return

      const clipStartFrame = clipRange.start
      const clipEndFrame = clipRange.end
      const clipDurationFrames = Math.max(0, clipEndFrame - clipStartFrame + 1)
      if (clipDurationFrames <= 0) return

      const relativeFrame = Math.max(0, projectFrame - clipStartFrame)
      if (relativeFrame >= clipDurationFrames) return

      const remainingClipFrames = Math.max(0, clipEndFrame - projectFrame + 1)
      const availableFromOffsetFrames = Math.max(0, durationFrames - relativeFrame)
      const playFrames = Math.min(remainingClipFrames, availableFromOffsetFrames)
      if (playFrames <= 0) return

      const ctx = await ensureAudioContext()
      try {
        await ctx.resume()
      } catch {
        // ignore
      }

      const buffer = await fetchAudioBuffer(resolvedSound.path, ctx)

      const offsetSec = (trimStartFrames + relativeFrame) / fps
      const durSec = playFrames / fps
      const clampedOffset = Math.min(Math.max(0, offsetSec), Math.max(0, buffer.duration))
      const maxDur = Math.max(0, buffer.duration - clampedOffset)
      const clampedDur = Math.min(durSec, maxDur)
      if (clampedDur <= 0) return

      stopPlayback()

      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(gainRef.current ?? ctx.destination)
      sourceRef.current = source
      playingPathRef.current = resolvedSound.path

      source.onended = () => {
        if (sourceRef.current === source) {
          sourceRef.current = null
          playingPathRef.current = null
        }
      }

      source.start(0, clampedOffset, clampedDur)
    },
    [
      clipRange,
      durationFrames,
      ensureAudioContext,
      resolvedSound.path,
      stopPlayback,
      trimStartFrames,
    ],
  )

  useEffect(() => {
    if (!clipRange) return

    const projectStartFrame = clipRange.start
    const clipDurationFrames = Math.max(0, clipRange.end - clipRange.start + 1)
    const availableFrames = durationFrames
    const clamped = Math.min(clipDurationFrames, availableFrames)
    if (clamped <= 0) return

    registerAudioSegmentGlobal({
      id,
      source: { kind: "sound", path: resolvedSound.path },
      projectStartFrame,
      sourceStartFrame: trimStartFrames,
      durationFrames: clamped,
    })

    return () => {
      unregisterAudioSegmentGlobal(id)
    }
  }, [clipRange, durationFrames, id, resolvedSound.path, trimStartFrames])

  useEffect(() => {
    if (isRender) return

    const prev = prevFrameRef.current
    prevFrameRef.current = globalFrame

    const shouldPlay = Boolean(clipRange) && isPlaying && isActive
    if (!shouldPlay) {
      stopPlayback()
      return
    }

    const wasPlayingSame =
      sourceRef.current != null && playingPathRef.current === resolvedSound.path
    const isSeek =
      prev != null &&
      (globalFrame < prev || globalFrame - prev > PROJECT_SETTINGS.fps * 2)

    if (!wasPlayingSame || isSeek) {
      void startPlaybackAt(globalFrame)
    }
  }, [
    clipRange,
    globalFrame,
    isActive,
    isPlaying,
    isRender,
    resolvedSound.path,
    startPlaybackAt,
    stopPlayback,
  ])

  useEffect(() => {
    return () => {
      stopPlayback()
    }
  }, [stopPlayback])

  return null
}
