import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { PROJECT_SETTINGS } from "../../../project/project"
import { useGlobalCurrentFrame } from "../frame"
import { useClipActive, useClipId, useClipRange, useProvideClipDuration } from "../clip"
import { registerAudioSegmentGlobal, unregisterAudioSegmentGlobal } from "../audio-plan"
import { fetchAudioBuffer } from "../audio"
import { useIsPlaying, useIsRender } from "../studio-state"
import type { Trim } from "../trim"
import { resolveTrimFrames } from "../trim"

/**
 * Sound source descriptor.
 *
 * 音声ソースの記述。
 *
 * @example
 * ```ts
 * const sound: Sound = { path: "assets/music.mp3" }
 * ```
 */
export type Sound = {
  path: string
}

/**
 * Props for <Sound>.
 *
 * <Sound> の props。
 *
 * @example
 * ```tsx
 * <Sound sound="assets/music.mp3" />
 * ```
 */
export type SoundProps = {
  sound: Sound | string
  trim?: Trim
  fadeInFrames?: number
  fadeOutFrames?: number
  volume?: number
  showWaveform?: boolean
}

/**
 * Normalizes a sound input into a Sound object.
 *
 * Sound 入力を正規化します。
 *
 * @example
 * ```ts
 * const s = normalizeSound("assets/music.mp3")
 * ```
 */
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
const soundLengthPending = new Map<string, Promise<number>>()
const MAX_REASONABLE_DURATION_MS = 1000 * 60 * 60 * 24 * 7 // 7 days

/**
 * Returns sound length in frames (project FPS).
 *
 * 音声の長さをフレーム数で返します。
 *
 * @example
 * ```ts
 * const frames = sound_length("assets/music.mp3")
 * ```
 */
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

const fetchSoundLengthAsync = async (sound: Sound): Promise<number> => {
  const cached = soundLengthCache.get(sound.path)
  if (cached != null) return cached

  const pending = soundLengthPending.get(sound.path)
  if (pending) return pending

  const next = (async () => {
    try {
      const res = await fetch(buildMetaUrl(sound))
      if (!res.ok) {
        soundLengthCache.set(sound.path, 0)
        return 0
      }
      const payload = (await res.json()) as { duration_ms?: number }
      const rawMs = typeof payload.duration_ms === "number" ? payload.duration_ms : 0
      if (!Number.isFinite(rawMs) || rawMs <= 0 || rawMs > MAX_REASONABLE_DURATION_MS) {
        soundLengthCache.set(sound.path, 0)
        return 0
      }
      const seconds = rawMs / 1000
      const frames = Math.round(seconds * PROJECT_SETTINGS.fps)
      const resolvedFrames = frames > 0 ? frames : 0
      soundLengthCache.set(sound.path, resolvedFrames)
      return resolvedFrames
    } catch (error) {
      console.error("fetchSoundLengthAsync(): failed to fetch metadata", error)
      soundLengthCache.set(sound.path, 0)
      return 0
    } finally {
      soundLengthPending.delete(sound.path)
    }
  })()

  soundLengthPending.set(sound.path, next)
  return next
}

const useSoundLengthFrames = (sound: Sound, syncMode: boolean) => {
  const [frames, setFrames] = useState<number>(() => {
    const cached = soundLengthCache.get(sound.path)
    if (cached != null) return cached
    if (syncMode) return sound_length(sound)
    return 0
  })

  useEffect(() => {
    if (syncMode) {
      setFrames(sound_length(sound))
      return
    }
    const cached = soundLengthCache.get(sound.path)
    if (cached != null) {
      setFrames(cached)
      return
    }

    let cancelled = false
    void fetchSoundLengthAsync(sound).then((next) => {
      if (!cancelled) setFrames(next)
    })
    return () => {
      cancelled = true
    }
  }, [sound, sound.path, syncMode])

  return frames
}

/**
 * Places an audio track on the timeline.
 *
 * タイムライン上に音声トラックを配置します。
 *
 * @example
 * ```tsx
 * <Sound sound="assets/music.mp3" trim={{ trimStart: 30 }} />
 * ```
 */
export const Sound = ({
  sound,
  trim,
  fadeInFrames = 0,
  fadeOutFrames = 0,
  volume = 1,
  showWaveform,
}: SoundProps) => {
  const id = useId()
  const clipId = useClipId()
  const clipRange = useClipRange()
  const isActive = useClipActive()
  const isPlaying = useIsPlaying()
  const isRender = useIsRender()
  const globalFrame = useGlobalCurrentFrame()
  const resolvedSound = useMemo(() => normalizeSound(sound), [sound])
  const rawDurationFrames = useSoundLengthFrames(resolvedSound, isRender)
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
  const normalizedVolume = Number.isFinite(volume) ? Math.max(0, volume) : 1

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
      const gain = gainRef.current ?? ctx.destination
      source.connect(gain)
      sourceRef.current = source
      playingPathRef.current = resolvedSound.path

      if (gainRef.current) {
        const now = ctx.currentTime
        const fadeInSec = Math.min(Math.max(0, fadeInFrames) / fps, clampedDur)
        const remaining = Math.max(0, clampedDur - fadeInSec)
        const fadeOutSec = Math.min(Math.max(0, fadeOutFrames) / fps, remaining)

        gainRef.current.gain.cancelScheduledValues(now)
        if (fadeInSec > 0) {
          gainRef.current.gain.setValueAtTime(0, now)
          gainRef.current.gain.linearRampToValueAtTime(
            normalizedVolume,
            now + fadeInSec,
          )
        } else {
          gainRef.current.gain.setValueAtTime(normalizedVolume, now)
        }

        if (fadeOutSec > 0) {
          const fadeOutStart = now + clampedDur - fadeOutSec
          gainRef.current.gain.setValueAtTime(normalizedVolume, fadeOutStart)
          gainRef.current.gain.linearRampToValueAtTime(0, now + clampedDur)
        }
      }

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
      fadeInFrames,
      fadeOutFrames,
      normalizedVolume,
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

    const fadeIn = Math.max(0, Math.round(fadeInFrames))
    const fadeOut = Math.max(0, Math.round(fadeOutFrames))
    registerAudioSegmentGlobal({
      id,
      source: { kind: "sound", path: resolvedSound.path },
      clipId: clipId ?? undefined,
      projectStartFrame,
      sourceStartFrame: trimStartFrames,
      durationFrames: clamped,
      fadeInFrames: Math.min(fadeIn, clamped),
      fadeOutFrames: Math.min(fadeOut, clamped),
      volume: normalizedVolume,
      showWaveform,
    })

    return () => {
      unregisterAudioSegmentGlobal(id)
    }
  }, [
    clipRange,
    clipId,
    durationFrames,
    fadeInFrames,
    fadeOutFrames,
    id,
    normalizedVolume,
    resolvedSound.path,
    showWaveform,
    trimStartFrames,
  ])

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
