import { fetchAudioBuffer } from "./audio"

export type WaveformData = {
  peaks: Float32Array
  durationSec: number
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

export const loadWaveformData = async (path: string): Promise<WaveformData | null> => {
  if (!path) return null
  if (waveformCache.has(path)) {
    return waveformCache.get(path) ?? null
  }

  const existing = waveformPromises.get(path)
  if (existing) return existing

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
    }
  })()

  waveformPromises.set(path, promise)
  return promise
}
