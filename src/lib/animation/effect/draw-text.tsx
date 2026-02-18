import type { CSSProperties } from "react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import opentype, { type Font } from "opentype.js"
import { useCurrentFrame } from "../../frame"
import { useProvideClipDuration } from "../../clip"
import type { Variable } from "../../animation"
import "mathjax-full/es5/tex-svg"

/**
 * Props for stroke-animated text.
 *
 * ストローク描画アニメーション用のテキスト props。
 */
export type DrawTextProps = {
  text: string
  fontUrl: string
  fontSize?: number
  strokeWidth?: number
  strokeColor?: string
  fillColor?: string
  durationFrames?: number
  delayFrames?: number
  frame?: number | Variable<number>
  progress?: number | Variable<number>
  lagRatio?: number
  fillDurationFrames?: number
  fillDelayFrames?: number
  outStartFrames?: number
  outDurationFrames?: number
  outLagRatio?: number
  lineHeight?: number
  align?: "left" | "center" | "right"
  style?: CSSProperties
}

/**
 * Props for TeX stroke-animated text.
 *
 * TeX のストローク描画アニメーション用 props。
 */
export type DrawTexProps = {
  tex: string
  fontSize?: number
  strokeWidth?: number
  strokeColor?: string
  fillColor?: string
  durationFrames?: number
  delayFrames?: number
  frame?: number | Variable<number>
  progress?: number | Variable<number>
  lagRatio?: number
  fillDurationFrames?: number
  fillDelayFrames?: number
  outStartFrames?: number
  outDurationFrames?: number
  outLagRatio?: number
  displayMode?: boolean
  style?: CSSProperties
}

type GlyphPath = {
  d: string
  isGap: boolean
  transform?: string
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
const DEFAULT_LAG_RATIO = 0.6
const STROKE_VISIBLE_EPSILON = 1e-4

const resolveTimelineValue = (
  source: number | Variable<number> | undefined,
  baseFrame: number,
) => {
  if (source == null) return null
  if (typeof source === "number") return source
  if (typeof source.get === "function") return source.get(baseFrame)
  return null
}
const fontCache = new Map<string, Promise<Font>>()
const DRAW_TEXT_TRACKER_KEY = "__frameScript_DrawTextTracker"

type DrawTextTracker = {
  pending: number
  start: () => () => void
  wait: () => Promise<void>
}

const getDrawTextTracker = () => {
  const g = globalThis as unknown as Record<string, unknown>
  const existing = g[DRAW_TEXT_TRACKER_KEY] as DrawTextTracker | undefined
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

  const tracker: DrawTextTracker = {
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

  g[DRAW_TEXT_TRACKER_KEY] = tracker
  return tracker
}

const useDrawTextPending = () => {
  const loadIdRef = useRef(0)
  const pendingFinishRef = useRef<(() => void) | null>(null)

  const beginPending = useCallback(() => {
    loadIdRef.current += 1
    if (!pendingFinishRef.current) {
      pendingFinishRef.current = getDrawTextTracker().start()
    }
    return loadIdRef.current
  }, [])

  const endPending = useCallback(() => {
    if (pendingFinishRef.current) {
      pendingFinishRef.current()
      pendingFinishRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      endPending()
    }
  }, [endPending])

  return { beginPending, endPending, loadIdRef }
}

const useGlyphLengths = (glyphs: GlyphPath[]) => {
  const [glyphLengths, setGlyphLengths] = useState<number[]>([])
  const pathRefs = useRef<Array<SVGPathElement | null>>([])

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

  return { glyphLengths, setGlyphLengths, pathRefs }
}

const getDrawableCount = (glyphs: GlyphPath[], glyphLengths: number[]) => {
  let count = 0
  glyphs.forEach((glyph, index) => {
    if (glyph.isGap) return
    if ((glyphLengths[index] ?? 0) > 0) count += 1
  })
  if (count > 0) return count
  return glyphs.filter((glyph) => !glyph.isGap).length
}

const resolveStaggerTiming = (totalFrames: number, count: number, ratio: number) => {
  if (count <= 0) return { per: 0, step: 0 }
  const denom = 1 + ratio * Math.max(0, count - 1)
  const per = Math.max(1, Math.round(totalFrames / Math.max(1, denom)))
  const step = count > 1 ? Math.max(1, Math.round(per * ratio)) : per
  return { per, step }
}

const computeTotalDuration = (params: {
  glyphs: GlyphPath[]
  glyphLengths: number[]
  durationFrames: number
  delayFrames: number
  lagRatio?: number
  fillDurationFrames: number
  fillDelayFrames: number
  outStartFrames?: number
  outDurationFrames?: number
  outLagRatio?: number
  resolvedFillColor: string
}) => {
  const {
    glyphs,
    glyphLengths,
    durationFrames,
    delayFrames,
    lagRatio,
    fillDurationFrames,
    fillDelayFrames,
    outStartFrames,
    outDurationFrames,
    outLagRatio,
    resolvedFillColor,
  } = params

  const drawCount = getDrawableCount(glyphs, glyphLengths)
  const safeDelay = Math.max(0, delayFrames)
  if (drawCount <= 0) {
    return Math.max(1, Math.round(Math.max(0, durationFrames) + safeDelay))
  }

  const safeLagRatio = Number.isFinite(lagRatio) ? Math.max(0, lagRatio ?? 0) : DEFAULT_LAG_RATIO
  const safeOutLagRatio = Number.isFinite(outLagRatio)
    ? Math.max(0, outLagRatio ?? 0)
    : safeLagRatio
  const { per: perGlyphFrames, step: stepFrames } = resolveStaggerTiming(
    durationFrames,
    drawCount,
    safeLagRatio,
  )

  let lastStrokeEnd = safeDelay + stepFrames * (drawCount - 1) + perGlyphFrames
  let total = lastStrokeEnd

  if (resolvedFillColor !== "transparent" && fillDurationFrames > 0) {
    const fillEnd = lastStrokeEnd + Math.max(0, fillDelayFrames) + fillDurationFrames
    total = Math.max(total, fillEnd)
  }

  if (outStartFrames != null && outDurationFrames && outDurationFrames > 0) {
    const { per: outPer, step: outStep } = resolveStaggerTiming(
      outDurationFrames,
      drawCount,
      safeOutLagRatio,
    )
    const outEnd = Math.max(0, outStartFrames) + outStep * (drawCount - 1) + outPer
    total = Math.max(total, outEnd)
  }

  return Math.max(1, Math.round(total))
}

const renderGlyphSvg = (params: {
  frame: number
  glyphs: GlyphPath[]
  glyphLengths: number[]
  pathRefs: { current: Array<SVGPathElement | null> }
  viewBox: string
  boxSize: { width: number; height: number }
  strokeWidth: number
  strokeColor: string
  resolvedFillColor: string
  durationFrames: number
  delayFrames: number
  lagRatio?: number
  fillDurationFrames: number
  fillDelayFrames: number
  outStartFrames?: number
  outDurationFrames?: number
  outLagRatio?: number
  style?: CSSProperties
}) => {
  const {
    frame,
    glyphs,
    glyphLengths,
    pathRefs,
    viewBox,
    boxSize,
    strokeWidth,
    strokeColor,
    resolvedFillColor,
    durationFrames,
    delayFrames,
    lagRatio,
    fillDurationFrames,
    fillDelayFrames,
    outStartFrames,
    outDurationFrames,
    outLagRatio,
    style,
  } = params

  const drawCount = getDrawableCount(glyphs, glyphLengths)
  const safeLagRatio = Number.isFinite(lagRatio) ? Math.max(0, lagRatio ?? 0) : DEFAULT_LAG_RATIO
  const safeOutLagRatio = Number.isFinite(outLagRatio)
    ? Math.max(0, outLagRatio ?? 0)
    : safeLagRatio
  const { per: perGlyphFrames, step: stepFrames } = resolveStaggerTiming(
    durationFrames,
    drawCount,
    safeLagRatio,
  )
  const { per: outPerGlyphFrames, step: outStepFrames } =
    outDurationFrames && outDurationFrames > 0
      ? resolveStaggerTiming(outDurationFrames, drawCount, safeOutLagRatio)
      : { per: 0, step: 0 }

  let cursor = delayFrames
  const glyphTimings = glyphs.map((glyph, index) => {
    if (glyph.isGap || (glyphLengths[index] ?? 0) <= 0) {
      return { start: cursor, duration: 0 }
    }
    const start = cursor
    cursor += stepFrames
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
      outCursor += outStepFrames
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
        // Workaround for Chromium/Skia: stroke-dash can leak a 1px cap at progress=0 on Windows.
        const strokeVisible = length > 0 && progress > STROKE_VISIBLE_EPSILON
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
            transform={glyph.transform}
            fill={resolvedFillColor}
            fillOpacity={fillOpacity}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={length || 1}
            strokeDashoffset={dashOffset}
            strokeOpacity={strokeVisible ? 1 : 0}
            style={{ opacity: length > 0 ? 1 : 0 }}
          />
        )
      })}
    </svg>
  )
}

const installDrawTextApi = () => {
  if (typeof window === "undefined") return
  const tracker = getDrawTextTracker()
  const waitDrawTextReady = async () => {
    while (true) {
      if (tracker.pending === 0) {
        if (typeof window.requestAnimationFrame !== "function") {
          return
        }
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
        if (tracker.pending === 0) return
      }
      await tracker.wait()
    }
  }

  ;(window as any).__frameScript = {
    ...(window as any).__frameScript,
    waitDrawTextReady,
    getDrawTextPending: () => tracker.pending,
  }
}

if (typeof window !== "undefined") {
  installDrawTextApi()
}

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

type MathJaxLike = {
  tex2svg?: (tex: string, options?: Record<string, unknown>) => Element
  startup?: { promise?: Promise<void> }
}

const resolveMathJax = () => {
  const mj = (globalThis as unknown as { MathJax?: MathJaxLike }).MathJax
  if (!mj || typeof mj.tex2svg !== "function") return null
  return mj
}

const parseSvgLength = (value: string | null, em: number, ex: number) => {
  if (!value) return null
  const match = value.trim().match(/^([+-]?\d*\.?\d+)([a-z%]*)$/i)
  if (!match) return null
  const size = Number.parseFloat(match[1])
  if (!Number.isFinite(size)) return null
  const unit = match[2] || "px"
  if (unit === "em") return size * em
  if (unit === "ex") return size * ex
  if (unit === "px" || unit === "") return size
  return size
}

const resolveSvgMetrics = (svg: SVGSVGElement, em: number, ex: number) => {
  const widthAttr = parseSvgLength(svg.getAttribute("width"), em, ex)
  const heightAttr = parseSvgLength(svg.getAttribute("height"), em, ex)

  const viewBoxAttr = svg.getAttribute("viewBox")
  if (viewBoxAttr) {
    const parts = viewBoxAttr
      .trim()
      .split(/[ ,]+/)
      .map((value) => Number.parseFloat(value))
      .filter((value) => Number.isFinite(value))
    if (parts.length >= 4) {
      const width = Math.max(0, widthAttr ?? parts[2])
      const height = Math.max(0, heightAttr ?? parts[3])
      return {
        viewBox: `${parts[0]} ${parts[1]} ${parts[2]} ${parts[3]}`,
        boxSize: { width, height },
      }
    }
  }

  const width = widthAttr ?? 0
  const height = heightAttr ?? 0
  return {
    viewBox: `0 0 ${width} ${height}`,
    boxSize: { width, height },
  }
}

const escapeSelector = (value: string) => {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value)
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&")
}

const collectParentTransforms = (element: Element | null) => {
  const transforms: string[] = []
  let node = element?.parentElement ?? null
  while (node) {
    const t = node.getAttribute("transform")
    if (t) transforms.push(t)
    if (node.tagName.toLowerCase() === "svg") break
    node = node.parentElement
  }
  return transforms.reverse()
}

const collectSelfTransform = (element: Element | null) =>
  element?.getAttribute("transform")?.trim() || ""

const joinTransforms = (parts: Array<string | null | undefined>) =>
  parts
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0)
    .join(" ")
    .trim()

const collectSvgGlyphs = (svg: SVGSVGElement): GlyphPath[] => {
  const glyphs: GlyphPath[] = []
  const defs = new Map<string, { d: string; transform?: string }>()
  svg.querySelectorAll("defs path[id]").forEach((path) => {
    const id = path.getAttribute("id")
    const d = path.getAttribute("d")
    if (!id || !d) return
    defs.set(id, { d, transform: collectSelfTransform(path) || undefined })
  })

  const addGlyph = (d: string, node: Element, extraTransform?: string | null) => {
    if (!d) return
    const transform = joinTransforms([
      ...collectParentTransforms(node),
      collectSelfTransform(node),
      extraTransform ?? null,
    ])
    glyphs.push({ d, isGap: false, transform: transform || undefined })
  }

  const parsePoints = (value: string | null) => {
    if (!value) return []
    const nums = value
      .trim()
      .split(/[\s,]+/)
      .map((part) => Number.parseFloat(part))
      .filter((num) => Number.isFinite(num))
    const points: Array<{ x: number; y: number }> = []
    for (let i = 0; i + 1 < nums.length; i += 2) {
      points.push({ x: nums[i], y: nums[i + 1] })
    }
    return points
  }

  const rectToPath = (rect: SVGRectElement) => {
    const x = Number.parseFloat(rect.getAttribute("x") ?? "0")
    const y = Number.parseFloat(rect.getAttribute("y") ?? "0")
    const width = Number.parseFloat(rect.getAttribute("width") ?? "0")
    const height = Number.parseFloat(rect.getAttribute("height") ?? "0")
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null
    }
    return `M ${x} ${y} h ${width} v ${height} h ${-width} Z`
  }

  const lineToPath = (line: SVGLineElement) => {
    const x1 = Number.parseFloat(line.getAttribute("x1") ?? "0")
    const y1 = Number.parseFloat(line.getAttribute("y1") ?? "0")
    const x2 = Number.parseFloat(line.getAttribute("x2") ?? "0")
    const y2 = Number.parseFloat(line.getAttribute("y2") ?? "0")
    if (![x1, y1, x2, y2].every((v) => Number.isFinite(v))) return null
    return `M ${x1} ${y1} L ${x2} ${y2}`
  }

  const polyToPath = (points: Array<{ x: number; y: number }>, close: boolean) => {
    if (points.length < 2) return null
    const [first, ...rest] = points
    const parts = [`M ${first.x} ${first.y}`]
    for (const pt of rest) {
      parts.push(`L ${pt.x} ${pt.y}`)
    }
    if (close) parts.push("Z")
    return parts.join(" ")
  }

  svg.querySelectorAll("path, use, rect, line, polygon, polyline").forEach((node) => {
    if (!(node instanceof SVGElement)) return
    if (node.closest("defs")) return
    const tag = node.tagName.toLowerCase()
    if (tag === "path") {
      const d = node.getAttribute("d")
      if (!d) return
      addGlyph(d, node)
      return
    }

    if (tag === "rect") {
      const d = rectToPath(node as SVGRectElement)
      if (!d) return
      addGlyph(d, node)
      return
    }

    if (tag === "line") {
      const d = lineToPath(node as SVGLineElement)
      if (!d) return
      addGlyph(d, node)
      return
    }

    if (tag === "polygon" || tag === "polyline") {
      const points = parsePoints(node.getAttribute("points"))
      const d = polyToPath(points, tag === "polygon")
      if (!d) return
      addGlyph(d, node)
      return
    }

    if (tag === "use") {
      const href =
        node.getAttribute("href") ||
        node.getAttribute("xlink:href") ||
        node.getAttributeNS("http://www.w3.org/1999/xlink", "href")
      if (!href) return
      const id = href.startsWith("#") ? href.slice(1) : href
      const ref = defs.get(id) || (() => {
        const selector = `#${escapeSelector(id)}`
        const found = svg.querySelector(selector)
        if (found instanceof SVGPathElement) {
          const d = found.getAttribute("d")
          if (d) return { d, transform: collectSelfTransform(found) || undefined }
        }
        return null
      })()
      if (!ref?.d) return

      const x = Number.parseFloat(node.getAttribute("x") ?? "0")
      const y = Number.parseFloat(node.getAttribute("y") ?? "0")
      const translate =
        Number.isFinite(x) || Number.isFinite(y) ? `translate(${x || 0} ${y || 0})` : null
      const transform = joinTransforms([
        ...collectParentTransforms(node),
        ref.transform,
        translate,
        collectSelfTransform(node),
      ])
      glyphs.push({ d: ref.d, isGap: false, transform: transform || undefined })
    }
  })

  return glyphs
}

/**
 * Renders text as animated SVG strokes.
 *
 * テキストを SVG ストロークとして描画します。
 *
 * @example
 * ```tsx
 * import { useAnimation, useVariable } from "../src/lib/animation"
 * import { seconds } from "../src/lib/frame"
 *
 * const Title = () => {
 *   const progress = useVariable(0)
 *
 *   useAnimation(async (context) => {
 *     await context.move(progress).to(1, seconds(2))
 *   })
 *
 *   return <DrawText text="Hello" fontUrl="assets/Roboto.ttf" progress={progress} />
 * }
 * ```
 */
export const DrawText = ({
  text,
  fontUrl,
  fontSize = 96,
  strokeWidth = 1,
  strokeColor = "#ffffff",
  fillColor,
  durationFrames = 180,
  delayFrames = 0,
  frame: frameOverride,
  progress: progressOverride,
  lagRatio = 0.2,
  fillDurationFrames = 18,
  fillDelayFrames = 0,
  outStartFrames,
  outDurationFrames,
  outLagRatio = 0.5,
  lineHeight = 1.2,
  align = "left",
  style,
}: DrawTextProps) => {
  const baseFrame = useCurrentFrame()
  const resolvedFillColor = fillColor ?? strokeColor
  const [glyphs, setGlyphs] = useState<GlyphPath[]>([])
  const [viewBox, setViewBox] = useState("0 0 0 0")
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 })
  const { glyphLengths, setGlyphLengths, pathRefs } = useGlyphLengths(glyphs)
  const [glyphLoadId, setGlyphLoadId] = useState(0)
  const { beginPending, endPending, loadIdRef } = useDrawTextPending()
  const totalDuration = useMemo(
    () =>
      computeTotalDuration({
        glyphs,
        glyphLengths,
        durationFrames,
        delayFrames,
        lagRatio,
        fillDurationFrames,
        fillDelayFrames,
        outStartFrames,
        outDurationFrames,
        outLagRatio,
        resolvedFillColor,
      }),
    [
      glyphs,
      glyphLengths,
      durationFrames,
      delayFrames,
      lagRatio,
      fillDurationFrames,
      fillDelayFrames,
      outStartFrames,
      outDurationFrames,
      outLagRatio,
      resolvedFillColor,
    ],
  )
  const shouldReportDuration = progressOverride == null
  useProvideClipDuration(shouldReportDuration ? totalDuration : null)
  const progressValue = resolveTimelineValue(progressOverride, baseFrame)
  const frameValue = resolveTimelineValue(frameOverride, baseFrame)
  const resolvedFrame = useMemo(() => {
    if (progressValue != null) {
      const span = Math.max(0, totalDuration - 1)
      return clamp01(progressValue) * span
    }
    if (frameValue != null) {
      return Math.max(0, frameValue)
    }
    return baseFrame
  }, [baseFrame, frameValue, progressValue, totalDuration])

  useEffect(() => {
    const loadId = beginPending()
    let cancelled = false
    const lines = text.split(/\r?\n/)
    if (!fontUrl || lines.length === 0) {
      setGlyphs([])
      setGlyphLoadId(loadId)
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
        setGlyphLoadId(loadId)
        setGlyphLengths([])
      })
      .catch((error) => {
        if (cancelled) return
        console.error("DrawText: failed to load font", error)
        setGlyphs([])
        setGlyphLoadId(loadId)
        setViewBox((prev) => (prev === "0 0 0 0" ? prev : "0 0 0 0"))
        setBoxSize((prev) => (prev.width === 0 && prev.height === 0 ? prev : { width: 0, height: 0 }))
      })

    return () => {
      cancelled = true
    }
  }, [align, fontSize, fontUrl, lineHeight, text])

  useEffect(() => {
    if (glyphLoadId !== loadIdRef.current) return
    if (glyphs.length === 0) {
      endPending()
      return
    }
    if (glyphLengths.length === glyphs.length) {
      endPending()
    }
  }, [endPending, glyphLoadId, glyphLengths, glyphs, loadIdRef])

  return renderGlyphSvg({
    frame: resolvedFrame,
    glyphs,
    glyphLengths,
    pathRefs,
    viewBox,
    boxSize,
    strokeWidth,
    strokeColor,
    resolvedFillColor,
    durationFrames,
    delayFrames,
    lagRatio,
    fillDurationFrames,
    fillDelayFrames,
    outStartFrames,
    outDurationFrames,
    outLagRatio,
    style,
  })
}

/**
 * Renders TeX as animated SVG strokes using MathJax (if available).
 *
 * MathJax がある場合に TeX を SVG に変換して描画します。
 *
 * @example
 * ```tsx
 * import { useAnimation, useVariable } from "../src/lib/animation"
 * import { seconds } from "../src/lib/frame"
 *
 * const Formula = () => {
 *   const progress = useVariable(0)
 *
 *   useAnimation(async (context) => {
 *     await context.move(progress).to(1, seconds(2))
 *   })
 *
 *   return (
 *     <DrawTex tex={"\\\\sum_{i=1}^{n} i = \\\\frac{n(n+1)}{2}"} fontSize={96} progress={progress} />
 *   )
 * }
 * ```
 */
export const DrawTex = ({
  tex,
  fontSize = 96,
  strokeWidth = 20,
  strokeColor = "#ffffff",
  fillColor,
  durationFrames = 180,
  delayFrames = 0,
  frame: frameOverride,
  progress: progressOverride,
  lagRatio = 0.5,
  fillDurationFrames = 18,
  fillDelayFrames = 0,
  outStartFrames,
  outDurationFrames,
  outLagRatio = 0.5,
  displayMode = false,
  style,
}: DrawTexProps) => {
  const baseFrame = useCurrentFrame()
  const resolvedFillColor = fillColor ?? strokeColor
  const [glyphs, setGlyphs] = useState<GlyphPath[]>([])
  const [viewBox, setViewBox] = useState("0 0 0 0")
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 })
  const { glyphLengths, setGlyphLengths, pathRefs } = useGlyphLengths(glyphs)
  const [glyphLoadId, setGlyphLoadId] = useState(0)
  const { beginPending, endPending, loadIdRef } = useDrawTextPending()
  const totalDuration = useMemo(
    () =>
      computeTotalDuration({
        glyphs,
        glyphLengths,
        durationFrames,
        delayFrames,
        lagRatio,
        fillDurationFrames,
        fillDelayFrames,
        outStartFrames,
        outDurationFrames,
        outLagRatio,
        resolvedFillColor,
      }),
    [
      glyphs,
      glyphLengths,
      durationFrames,
      delayFrames,
      lagRatio,
      fillDurationFrames,
      fillDelayFrames,
      outStartFrames,
      outDurationFrames,
      outLagRatio,
      resolvedFillColor,
    ],
  )
  const shouldReportDuration = progressOverride == null
  useProvideClipDuration(shouldReportDuration ? totalDuration : null)
  const progressValue = resolveTimelineValue(progressOverride, baseFrame)
  const frameValue = resolveTimelineValue(frameOverride, baseFrame)
  const resolvedFrame = useMemo(() => {
    if (progressValue != null) {
      const span = Math.max(0, totalDuration - 1)
      return clamp01(progressValue) * span
    }
    if (frameValue != null) {
      return Math.max(0, frameValue)
    }
    return baseFrame
  }, [baseFrame, frameValue, progressValue, totalDuration])

  const texInput = useMemo(() => tex.trim(), [tex])

  useEffect(() => {
    const loadId = beginPending()
    let cancelled = false

    if (!texInput) {
      setGlyphs([])
      setGlyphLoadId(loadId)
      setViewBox((prev) => (prev === "0 0 0 0" ? prev : "0 0 0 0"))
      setBoxSize((prev) => (prev.width === 0 && prev.height === 0 ? prev : { width: 0, height: 0 }))
      return
    }

    const run = async () => {
      const mj = resolveMathJax()
      if (!mj) {
        console.error("DrawTex: MathJax is not available")
        if (!cancelled) {
          setGlyphs([])
          setGlyphLoadId(loadId)
          setViewBox((prev) => (prev === "0 0 0 0" ? prev : "0 0 0 0"))
          setBoxSize((prev) => (prev.width === 0 && prev.height === 0 ? prev : { width: 0, height: 0 }))
        }
        return
      }

      try {
        if (mj.startup?.promise) {
          await mj.startup.promise
        }
        const ex = fontSize * 0.45
        const svgNode = mj.tex2svg?.(texInput, {
          display: displayMode,
          em: fontSize,
          ex,
        })
        if (!svgNode) {
          throw new Error("DrawTex: failed to create SVG")
        }
        const svg =
          svgNode instanceof SVGSVGElement
            ? svgNode
            : (svgNode.querySelector?.("svg") as SVGSVGElement | null)
        if (!svg) {
          throw new Error("DrawTex: SVG element not found")
        }

        const metrics = resolveSvgMetrics(svg, fontSize, ex)
        const glyphs = collectSvgGlyphs(svg)

        if (cancelled) return
        setViewBox(metrics.viewBox)
        setBoxSize(metrics.boxSize)
        setGlyphs(glyphs)
        setGlyphLoadId(loadId)
        setGlyphLengths([])
      } catch (error) {
        if (cancelled) return
        console.error("DrawTex: failed to render tex", error)
        setGlyphs([])
        setGlyphLoadId(loadId)
        setViewBox((prev) => (prev === "0 0 0 0" ? prev : "0 0 0 0"))
        setBoxSize((prev) => (prev.width === 0 && prev.height === 0 ? prev : { width: 0, height: 0 }))
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [beginPending, displayMode, fontSize, texInput, setGlyphLengths])

  useEffect(() => {
    if (glyphLoadId !== loadIdRef.current) return
    if (glyphs.length === 0) {
      endPending()
      return
    }
    if (glyphLengths.length === glyphs.length) {
      endPending()
    }
  }, [endPending, glyphLoadId, glyphLengths, glyphs, loadIdRef])

  return renderGlyphSvg({
    frame: resolvedFrame,
    glyphs,
    glyphLengths,
    pathRefs,
    viewBox,
    boxSize,
    strokeWidth,
    strokeColor,
    resolvedFillColor,
    durationFrames,
    delayFrames,
    lagRatio,
    fillDurationFrames,
    fillDelayFrames,
    outStartFrames,
    outDurationFrames,
    outLagRatio,
    style,
  })
}
