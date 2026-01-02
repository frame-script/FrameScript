import type { CSSProperties } from "react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import opentype, { type Font } from "opentype.js"
import { useCurrentFrame } from "../../frame"

type DrawTextProps = {
  text: string
  fontUrl: string
  fontSize?: number
  strokeWidth?: number
  strokeColor?: string
  fillColor?: string
  durationFrames?: number
  delayFrames?: number
  fillDurationFrames?: number
  fillDelayFrames?: number
  outStartFrames?: number
  outDurationFrames?: number
  lineHeight?: number
  align?: "left" | "center" | "right"
  style?: CSSProperties
}

type GlyphPath = {
  d: string
  isGap: boolean
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const fontCache = new Map<string, Promise<Font>>()

const buildFontUrl = (path: string) => {
  const url = new URL("http://localhost:3000/file")
  url.searchParams.set("path", path)
  return url.toString()
}

const resolveFontUrl = (url: string) => {
  if (/^(https?:|data:|blob:)/i.test(url)) return url
  if (url.startsWith("/")) return url
  if (url.startsWith("assets/")) {
    return new URL(`../${url}`, import.meta.url).toString()
  }
  return new URL(url, import.meta.url).toString()
}

const loadFont = async (fontUrl: string) => {
  const cached = fontCache.get(fontUrl)
  if (cached) return cached

  const promise = (async () => {
    const isRemote = /^(https?:|data:|blob:)/i.test(fontUrl)
    const candidates = isRemote
      ? [fontUrl]
      : [buildFontUrl(fontUrl), resolveFontUrl(fontUrl)]
    let lastError: unknown = null

    for (const candidate of candidates) {
      try {
        const res = await fetch(candidate)
        if (!res.ok) {
          throw new Error(`DrawText: failed to fetch font (${res.status}) ${candidate}`)
        }
        const buffer = await res.arrayBuffer()
        return opentype.parse(buffer)
      } catch (error) {
        lastError = error
      }
    }

    throw lastError
  })()

  promise.catch(() => {
    fontCache.delete(fontUrl)
  })

  fontCache.set(fontUrl, promise)
  return promise
}

export const DrawText = ({
  text,
  fontUrl,
  fontSize = 96,
  strokeWidth = 4,
  strokeColor = "#ffffff",
  fillColor,
  durationFrames = 180,
  delayFrames = 0,
  fillDurationFrames = 18,
  fillDelayFrames = 0,
  outStartFrames,
  outDurationFrames,
  lineHeight = 1.2,
  align = "left",
  style,
}: DrawTextProps) => {
  const frame = useCurrentFrame()
  const resolvedFillColor = fillColor ?? strokeColor
  const [glyphs, setGlyphs] = useState<GlyphPath[]>([])
  const [viewBox, setViewBox] = useState("0 0 0 0")
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 })
  const pathRefs = useRef<Array<SVGPathElement | null>>([])
  const [glyphLengths, setGlyphLengths] = useState<number[]>([])

  useEffect(() => {
    let cancelled = false
    const lines = text.split(/\r?\n/)
    if (!fontUrl || lines.length === 0) {
      setGlyphs([])
      setViewBox((prev) => (prev === "0 0 0 0" ? prev : "0 0 0 0"))
      setBoxSize((prev) => (prev.width === 0 && prev.height === 0 ? prev : { width: 0, height: 0 }))
      return
    }

    loadFont(fontUrl)
      .then((font) => {
        if (cancelled) return

        let minX = Number.POSITIVE_INFINITY
        let minY = Number.POSITIVE_INFINITY
        let maxX = Number.NEGATIVE_INFINITY
        let maxY = Number.NEGATIVE_INFINITY
        const nextGlyphs: GlyphPath[] = []
        const lineGap = fontSize * lineHeight

        lines.forEach((line, index) => {
          const width = font.getAdvanceWidth(line, fontSize)
          let x = 0
          if (align === "center") x = -width / 2
          if (align === "right") x = -width
          const y = fontSize + index * lineGap
          const chars = Array.from(line)
          chars.forEach((char) => {
            const advance = font.getAdvanceWidth(char, fontSize)
            if (!char.trim()) {
              x += advance
              return
            }
            const path = font.getPath(char, x, y, fontSize)
            const box = path.getBoundingBox()
            const d = path.toPathData(2)
            if (Number.isFinite(box.x1) && Number.isFinite(box.y1)) {
              minX = Math.min(minX, box.x1)
              minY = Math.min(minY, box.y1)
              maxX = Math.max(maxX, box.x2)
              maxY = Math.max(maxY, box.y2)
            }
            nextGlyphs.push({ d, isGap: false })
            x += advance
          })
        })

        if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
          setGlyphs([])
          setViewBox((prev) => (prev === "0 0 0 0" ? prev : "0 0 0 0"))
          setBoxSize((prev) => (prev.width === 0 && prev.height === 0 ? prev : { width: 0, height: 0 }))
          return
        }

        const width = Math.max(0, maxX - minX)
        const height = Math.max(0, maxY - minY)
        const nextViewBox = `${minX} ${minY} ${width} ${height}`
        setViewBox((prev) => (prev === nextViewBox ? prev : nextViewBox))
        setBoxSize((prev) =>
          prev.width === width && prev.height === height ? prev : { width, height },
        )
        setGlyphs(nextGlyphs)
        setGlyphLengths([])
      })
      .catch((error) => {
        if (cancelled) return
        console.error("DrawText: failed to load font", error)
        setGlyphs([])
        setViewBox((prev) => (prev === "0 0 0 0" ? prev : "0 0 0 0"))
        setBoxSize((prev) => (prev.width === 0 && prev.height === 0 ? prev : { width: 0, height: 0 }))
      })

    return () => {
      cancelled = true
    }
  }, [align, fontSize, fontUrl, lineHeight, text])

  useLayoutEffect(() => {
    if (glyphs.length === 0) {
      setGlyphLengths([])
      return
    }

    const next = glyphs.map((glyph, index) => {
      if (glyph.isGap) return 0
      const el = pathRefs.current[index]
      if (!el) return 0
      try {
        const length = el.getTotalLength()
        return Number.isFinite(length) ? length : 0
      } catch {
        return 0
      }
    })

    setGlyphLengths((prev) => {
      if (prev.length === next.length && prev.every((value, idx) => value === next[idx])) {
        return prev
      }
      return next
    })
  }, [glyphs])

  const drawCount = glyphs.reduce(
    (count, glyph, index) => count + (!glyph.isGap && (glyphLengths[index] ?? 0) > 0 ? 1 : 0),
    0,
  )
  const perGlyphFrames = drawCount > 0 ? Math.max(1, Math.round(durationFrames / drawCount)) : 0
  const outPerGlyphFrames =
    outDurationFrames && outDurationFrames > 0 && drawCount > 0
      ? Math.max(1, Math.round(outDurationFrames / drawCount))
      : 0

  let cursor = delayFrames
  const glyphTimings = glyphs.map((glyph, index) => {
    if (glyph.isGap || (glyphLengths[index] ?? 0) <= 0) {
      return { start: cursor, duration: 0 }
    }
    const start = cursor
    cursor += perGlyphFrames
    return { start, duration: perGlyphFrames }
  })

  const outStartBase = outStartFrames ?? null
  const outTimings = glyphs.map(() => ({ start: outStartBase ?? 0, duration: 0 }))
  if (outStartBase != null && outPerGlyphFrames > 0) {
    let outCursor = outStartBase
    const drawable = glyphs
      .map((glyph, index) => ({ glyph, index }))
      .filter(({ glyph, index }) => !glyph.isGap && (glyphLengths[index] ?? 0) > 0)
      .map(({ index }) => index)

    for (let i = drawable.length - 1; i >= 0; i -= 1) {
      const index = drawable[i]
      outTimings[index] = { start: outCursor, duration: outPerGlyphFrames }
      outCursor += outPerGlyphFrames
    }
  }

  return (
    <svg
      viewBox={viewBox}
      style={{
        display: "block",
        overflow: "visible",
        width: boxSize.width > 0 ? boxSize.width : undefined,
        height: boxSize.height > 0 ? boxSize.height : undefined,
        ...style,
      }}
    >
      {glyphs.map((glyph, index) => {
        if (!glyph.d) return null
        const length = glyphLengths[index] ?? 0
        const timing = glyphTimings[index]
        const inProgress =
          timing.duration > 0 ? clamp01((frame - timing.start) / timing.duration) : 0
        const outTiming = outTimings[index]
        const outProgress =
          outTiming.duration > 0 ? clamp01((frame - outTiming.start) / outTiming.duration) : 0
        const progress = outProgress > 0 ? inProgress * (1 - outProgress) : inProgress
        const dashOffset = length > 0 ? length * (1 - progress) : 0
        const fillStart = timing.start + timing.duration + fillDelayFrames
        const fillProgress =
          resolvedFillColor === "transparent"
            ? 0
            : clamp01((frame - fillStart) / Math.max(1, fillDurationFrames))
        const fillOpacity = fillProgress * (outProgress > 0 ? 1 - outProgress : 1)
        return (
          <path
            key={`${index}-${glyph.d}`}
            ref={(el) => {
              pathRefs.current[index] = el
            }}
            d={glyph.d}
            fill={resolvedFillColor}
            fillOpacity={fillOpacity}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={length || 1}
            strokeDashoffset={dashOffset}
            style={{ opacity: length > 0 ? 1 : 0 }}
          />
        )
      })}
    </svg>
  )
}
