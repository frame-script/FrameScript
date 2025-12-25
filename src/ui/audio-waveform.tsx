import { useEffect, useMemo, useRef, useState } from "react"
import { framesToSeconds } from "../lib/audio"
import { loadWaveformData, type WaveformData } from "../lib/audio-waveform"

const WAVEFORM_VERTICAL_OFFSET = -0.07

type AudioWaveformSegmentProps = {
  path: string
  startOffsetFrames: number
  durationFrames: number
  sourceStartFrame: number
  pxPerFrame: number
  height: number
  color: string
  opacity?: number
}

const useWaveformData = (path: string) => {
  const [data, setData] = useState<WaveformData | null>(null)

  useEffect(() => {
    let alive = true
    void loadWaveformData(path).then((resolved) => {
      if (alive) {
        setData(resolved)
      }
    })
    return () => {
      alive = false
    }
  }, [path])

  return data
}

const WaveformCanvas = ({
  data,
  startIndex,
  endIndex,
  width,
  height,
  color,
  opacity,
}: {
  data: WaveformData
  startIndex: number
  endIndex: number
  width: number
  height: number
  color: string
  opacity?: number
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const safeWidth = Math.max(1, Math.floor(width))
    const safeHeight = Math.max(1, Math.floor(height))
    canvas.width = safeWidth * dpr
    canvas.height = safeHeight * dpr
    canvas.style.width = `${safeWidth}px`
    canvas.style.height = `${safeHeight}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.clearRect(0, 0, safeWidth, safeHeight)
    ctx.strokeStyle = color
    ctx.globalAlpha = opacity ?? 0.45
    ctx.lineWidth = 1

    const range = Math.max(1, endIndex - startIndex)
    const mid = safeHeight / 2 + WAVEFORM_VERTICAL_OFFSET * safeHeight
    const samples = Math.max(1, safeWidth)

    ctx.beginPath()
    for (let x = 0; x < samples; x += 1) {
      const t = samples <= 1 ? 0 : x / (samples - 1)
      const idx = Math.min(
        data.peaks.length - 1,
        startIndex + Math.floor(t * range),
      )
      const amp = data.peaks[idx] ?? 0
      const boosted = Math.min(1, Math.pow(amp, 0.45) * 1.9)
      const bar = boosted * (safeHeight / 2)
      const xPos = x + 0.5
      ctx.moveTo(xPos, mid - bar)
      ctx.lineTo(xPos, mid + bar)
    }
    ctx.stroke()
    ctx.globalAlpha = 1
  }, [color, data.peaks, endIndex, height, opacity, startIndex, width])

  return <canvas ref={canvasRef} />
}

export const AudioWaveformSegment = ({
  path,
  startOffsetFrames,
  durationFrames,
  sourceStartFrame,
  pxPerFrame,
  height,
  color,
  opacity,
}: AudioWaveformSegmentProps) => {
  const data = useWaveformData(path)
  const width = Math.max(1, Math.round(durationFrames * pxPerFrame))
  const left = Math.max(0, Math.round(startOffsetFrames * pxPerFrame))

  const range = useMemo(() => {
    if (!data || data.peaks.length === 0 || data.durationSec <= 0) return null
    const startSec = framesToSeconds(sourceStartFrame)
    const endSec = framesToSeconds(sourceStartFrame + durationFrames)
    if (endSec <= 0 || startSec >= data.durationSec) return null

    const clampedStart = Math.max(0, startSec)
    const clampedEnd = Math.min(data.durationSec, Math.max(clampedStart, endSec))
    const startIndex = Math.floor((clampedStart / data.durationSec) * data.peaks.length)
    const endIndex = Math.max(
      startIndex + 1,
      Math.ceil((clampedEnd / data.durationSec) * data.peaks.length),
    )

    return { startIndex, endIndex }
  }, [data, durationFrames, sourceStartFrame])

  if (!data || !range || width <= 1 || height <= 2) return null

  return (
    <div
      style={{
        position: "absolute",
        left,
        top: 0,
        bottom: 0,
        width,
        height: "100%",
        pointerEvents: "none",
      }}
    >
      <WaveformCanvas
        data={data}
        startIndex={range.startIndex}
        endIndex={range.endIndex}
        width={width}
        height={height}
        color={color}
        opacity={opacity}
      />
    </div>
  )
}
