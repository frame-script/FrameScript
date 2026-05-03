import { fetchAudioBuffer } from "./audio"

/**
 * Cached waveform data (peaks + duration).
 *
 * 波形データ（ピークと長さ）。
 *
 * @example
 * ```ts
 * const data: WaveformData = { peaks: new Float32Array(0), durationSec: 0 }
 * ```
 */
export type WaveformData = {
  peaks: Float32Array
  durationSec: number
}

type AudioWaveformTracker = {
  pending: number
  start: () => () => void
  wait: () => Promise<void>
}

const AUDIO_WAVEFORM_TRACKER_KEY = "__frameScript_AudioWaveformTracker"

const getAudioWaveformTracker = (): AudioWaveformTracker => {
  const g = globalThis as unknown as Record<string, unknown>
  const existing = g[AUDIO_WAVEFORM_TRACKER_KEY] as
    | AudioWaveformTracker
    | undefined
  if (existing) return existing

  let pending = 0
  const waiters = new Set<() => void>()

  const notifyIfReady = () => {
    if (pending !== 0) return
    for (const resolve of Array.from(waiters)) {
      resolve()
    }
    waiters.clear()
  }

  const tracker: AudioWaveformTracker = {
    get pending() {
      return pending
    },
    start: () => {
      pending += 1
      let done = false
      return () => {
        if (done) return
        done = true
        pending = Math.max(0, pending - 1)
        notifyIfReady()
      }
    },
    wait: () => {
      if (pending === 0) return Promise.resolve()
      return new Promise<void>((resolve) => {
        waiters.add(resolve)
      })
    },
  }

  g[AUDIO_WAVEFORM_TRACKER_KEY] = tracker
  return tracker
}

const waitForAnimationTick = () =>
  new Promise<void>((resolve) => {
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      setTimeout(resolve, 0)
      return
    }
    window.requestAnimationFrame(() => resolve())
  })

const installAudioWaveformApi = () => {
  if (typeof window === "undefined") return
  const tracker = getAudioWaveformTracker()
  const waitAudioWaveformsReady = async () => {
    while (true) {
      if (tracker.pending === 0) {
        await waitForAnimationTick()
        if (tracker.pending === 0) return
      }
      await tracker.wait()
    }
  }

  ;(window as any).__frameScript = {
    ...(window as any).__frameScript,
    waitAudioWaveformsReady,
    getAudioWaveformsPending: () => tracker.pending,
  }
}

if (typeof window !== "undefined") {
  installAudioWaveformApi()
}

const waveformCache = new Map<string, WaveformData | null>()
const waveformPromises = new Map<string, Promise<WaveformData | null>>()
let waveformAudioContext: AudioContext | null = null

const getAudioContext = () => {
  if (waveformAudioContext) return waveformAudioContext
  const Ctx = window.AudioContext || (window as any).webkitAudioContext
  waveformAudioContext = new Ctx()
  return waveformAudioContext
}

const buildWaveform = (buffer: AudioBuffer, bins: number) => {
  const length = buffer.length
  if (length === 0) {
    return new Float32Array(0)
  }

  const channels = buffer.numberOfChannels
  const peaks = new Float32Array(bins)
  const samplesPerBin = Math.max(1, Math.floor(length / bins))

  for (let i = 0; i < bins; i += 1) {
    const start = i * samplesPerBin
    const end = Math.min(start + samplesPerBin, length)
    let peak = 0

    for (let ch = 0; ch < channels; ch += 1) {
      const data = buffer.getChannelData(ch)
      for (let s = start; s < end; s += 1) {
        const value = Math.abs(data[s])
        if (value > peak) peak = value
      }
    }

    peaks[i] = peak
  }

  return peaks
}

/**
 * Loads waveform data for a file path (cached).
 *
 * ファイルパスから波形データを読み込みます（キャッシュ付き）。
 *
 * @example
 * ```ts
 * const data = await loadWaveformData("assets/music.mp3")
 * ```
 */
export const loadWaveformData = async (
  path: string,
): Promise<WaveformData | null> => {
  if (!path) return null
  if (waveformCache.has(path)) {
    return waveformCache.get(path) ?? null
  }

  const existing = waveformPromises.get(path)
  if (existing) return existing

  const finishPending = getAudioWaveformTracker().start()
  const promise = (async () => {
    try {
      const ctx = getAudioContext()
      const buffer = await fetchAudioBuffer(path, ctx)
      const durationSec = Number.isFinite(buffer.duration) ? buffer.duration : 0
      if (durationSec <= 0) {
        waveformCache.set(path, null)
        return null
      }
      const bins = Math.min(4000, Math.max(400, Math.round(durationSec * 120)))
      const peaks = buildWaveform(buffer, bins)
      const data = { peaks, durationSec }
      waveformCache.set(path, data)
      return data
    } catch (_error) {
      waveformCache.set(path, null)
      return null
    } finally {
      waveformPromises.delete(path)
      finishPending()
    }
  })()

  waveformPromises.set(path, promise)
  return promise
}
