import type { CSSProperties } from "react"
import { useMemo } from "react"
import type { Variable, Vec2 } from "../animation"
import PrismModule from "prismjs"
import "prismjs/components/prism-markup-templating"
import "prismjs/components/prism-jsx"
import "prismjs/components/prism-typescript"
import "prismjs/components/prism-tsx"
import "prismjs/components/prism-python"
import "prismjs/components/prism-rust"
import "prismjs/components/prism-go"
import "prismjs/components/prism-c"
import "prismjs/components/prism-cpp"
import "prismjs/components/prism-java"
import "prismjs/components/prism-csharp"
import "prismjs/components/prism-lua"
import "prismjs/components/prism-bash"
import "prismjs/components/prism-json"

type FrameValue<T> = T | Variable<T>

type PrismTokenNode = {
  type: string
  content: PrismTokenValue | PrismTokenValue[]
  alias?: string | string[]
}

type PrismTokenValue = string | PrismTokenNode

type PrismGrammar = Record<string, unknown>

type PrismLike = {
  languages: Record<string, PrismGrammar | undefined>
  tokenize: (text: string, grammar: PrismGrammar) => PrismTokenValue[]
}

const Prism = PrismModule as unknown as PrismLike

const isVariable = <T,>(value: FrameValue<T>): value is Variable<T> =>
  Boolean(value) && typeof (value as Variable<T>).use === "function"

const resolveValue = <T,>(value: FrameValue<T> | undefined): T | undefined => {
  if (value == null) return value
  return isVariable(value) ? value.use() : value
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const clampNumber = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback

const DEFAULT_HIGHLIGHT_COLOR = "#38bdf8"
const DEFAULT_HIGHLIGHT_FILL_ALPHA = 0.24

type RgbaColor = {
  r: number
  g: number
  b: number
  a: number
}

const toRgbaString = (rgba: RgbaColor) =>
  `rgba(${Math.round(clamp(rgba.r, 0, 255))}, ${Math.round(clamp(rgba.g, 0, 255))}, ${Math.round(clamp(rgba.b, 0, 255))}, ${clamp(rgba.a, 0, 1)})`

const parseHexColor = (value: string): RgbaColor | null => {
  const hex = value.trim().replace(/^#/, "")
  if (![3, 4, 6, 8].includes(hex.length) || !/^[0-9a-fA-F]+$/.test(hex)) {
    return null
  }

  const normalize = (part: string) =>
    part.length === 1 ? parseInt(part + part, 16) : parseInt(part, 16)

  if (hex.length === 3 || hex.length === 4) {
    const r = normalize(hex[0] ?? "0")
    const g = normalize(hex[1] ?? "0")
    const b = normalize(hex[2] ?? "0")
    const a = hex.length === 4 ? normalize(hex[3] ?? "f") / 255 : 1
    return { r, g, b, a }
  }

  const r = normalize(hex.slice(0, 2))
  const g = normalize(hex.slice(2, 4))
  const b = normalize(hex.slice(4, 6))
  const a = hex.length === 8 ? normalize(hex.slice(6, 8)) / 255 : 1
  return { r, g, b, a }
}

const parseRgbColor = (value: string): RgbaColor | null => {
  const match = value
    .trim()
    .match(/^rgba?\(\s*([-+]?[\d.]+)\s*,\s*([-+]?[\d.]+)\s*,\s*([-+]?[\d.]+)(?:\s*,\s*([-+]?[\d.]+))?\s*\)$/i)
  if (!match) return null

  const r = Number(match[1])
  const g = Number(match[2])
  const b = Number(match[3])
  const a = match[4] == null ? 1 : Number(match[4])
  if (![r, g, b, a].every((item) => Number.isFinite(item))) return null
  return { r, g, b, a }
}

const parseCssColor = (value: string): RgbaColor | null => {
  const hex = parseHexColor(value)
  if (hex) return hex
  const rgb = parseRgbColor(value)
  if (rgb) return rgb

  if (typeof document === "undefined") return null
  const canvas = document.createElement("canvas")
  const ctx = canvas.getContext("2d")
  if (!ctx) return null

  const fallback = "rgba(1, 2, 3, 0.12345)"
  ctx.fillStyle = fallback
  ctx.fillStyle = value
  const normalized = ctx.fillStyle.trim()
  if (normalized === fallback && value.trim().toLowerCase() !== fallback) return null
  return parseHexColor(normalized) ?? parseRgbColor(normalized)
}

const colorWithAlpha = (color: string, alpha: number) => {
  const parsed = parseCssColor(color)
  if (!parsed) {
    const percent = Math.round(clamp(alpha, 0, 1) * 100)
    return `color-mix(in srgb, ${color} ${percent}%, transparent)`
  }
  return toRgbaString({ ...parsed, a: clamp(alpha, 0, 1) })
}

const interpolateColor = (from: string, to: string, t: number) => {
  const fromColor = parseCssColor(from)
  const toColor = parseCssColor(to)
  if (!fromColor || !toColor) {
    return t < 0.5 ? from : to
  }
  return toRgbaString({
    r: fromColor.r + (toColor.r - fromColor.r) * t,
    g: fromColor.g + (toColor.g - fromColor.g) * t,
    b: fromColor.b + (toColor.b - fromColor.b) * t,
    a: fromColor.a + (toColor.a - fromColor.a) * t,
  })
}

const resolveHighlightFillColor = (fillColor: string | undefined, color: string) =>
  fillColor ?? colorWithAlpha(color, DEFAULT_HIGHLIGHT_FILL_ALPHA)

const snapToDevicePixel = (value: number) => {
  if (typeof window === "undefined") return value
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  return Math.round(value * dpr) / dpr
}

const resolveHighlightRect = (
  left: number,
  top: number,
  width: number,
  height: number,
  strokeWidth: number,
) => {
  const minSize = Math.max(0, strokeWidth) * 2
  const snappedLeft = snapToDevicePixel(left)
  const snappedTop = snapToDevicePixel(top)
  const snappedWidth = snapToDevicePixel(Math.max(minSize, width))
  const snappedHeight = snapToDevicePixel(Math.max(minSize, height))
  return {
    left: snappedLeft,
    top: snappedTop,
    width: snappedWidth,
    height: snappedHeight,
  }
}

type CodeLanguage =
  | "ts"
  | "tsx"
  | "js"
  | "jsx"
  | "python"
  | "rust"
  | "go"
  | "cpp"
  | "c"
  | "java"
  | "csharp"
  | "lua"
  | "bash"
  | "json"

type CodeStep = {
  code: string
  language: CodeLanguage
}

type CodeTheme = {
  base: string
  keyword: string
  type: string
  string: string
  number: string
  comment: string
  builtin: string
  punctuation: string
}

type HighlightRange = {
  line: number
  start: number
  end: number
}

type HighlightPadding = number | { x?: number; y?: number }

export type CodeHighlight = {
  id?: string
  range?: HighlightRange
  position?: FrameValue<Vec2>
  size?: FrameValue<Vec2>
  opacity?: FrameValue<number>
  radius?: number
  strokeWidth?: number
  color?: string
  fillColor?: string
}

export type CodeHighlightStep = {
  id?: string
  match: string
  codeStep?: number
  occurrence?: number
  ignoreWhitespace?: boolean
  padding?: HighlightPadding
  radius?: number
  strokeWidth?: number
  color?: string
  fillColor?: string
}

export type CodeHighlightTrack = {
  id?: string
  steps: CodeHighlightStep[]
  step?: FrameValue<number>
}

export type CodeProps = {
  steps: CodeStep[]
  step?: FrameValue<number>
  highlightTracks?: CodeHighlightTrack[]
  highlights?: CodeHighlight[]
  fontSize?: number
  lineHeight?: number
  fontFamily?: string
  padding?: number
  charWidth?: number
  tabSize?: number
  theme?: Partial<CodeTheme>
  style?: CSSProperties
  className?: string
}

type Token = {
  text: string
  color: string
}

type ParsedStep = {
  lines: string[]
  tokens: Token[][]
}

const DEFAULT_THEME: CodeTheme = {
  base: "#e2e8f0",
  keyword: "#7dd3fc",
  type: "#fca5a5",
  string: "#86efac",
  number: "#fbbf24",
  comment: "#94a3b8",
  builtin: "#c4b5fd",
  punctuation: "#e2e8f0",
}

const PRISM_LANGUAGE_MAP: Record<CodeLanguage, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  python: "python",
  rust: "rust",
  go: "go",
  cpp: "cpp",
  c: "c",
  java: "java",
  csharp: "csharp",
  lua: "lua",
  bash: "bash",
  json: "json",
}

const resolvePrismGrammar = (language: CodeLanguage): PrismGrammar | null => {
  const prismId = PRISM_LANGUAGE_MAP[language]
  return (
    Prism.languages[prismId] ??
    Prism.languages.javascript ??
    Prism.languages.clike ??
    null
  )
}

const toTypeList = (value: string | string[] | undefined) => {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

const flattenPrismTokens = (
  source: PrismTokenValue | PrismTokenValue[],
  inheritedTypes: string[] = [],
): Array<{ text: string; types: string[] }> => {
  if (typeof source === "string") {
    return source.length > 0 ? [{ text: source, types: inheritedTypes }] : []
  }

  if (Array.isArray(source)) {
    return source.flatMap((item) => flattenPrismTokens(item, inheritedTypes))
  }

  const nextTypes = [
    ...inheritedTypes,
    source.type,
    ...toTypeList(source.alias),
  ]
  return flattenPrismTokens(source.content, nextTypes)
}

const hasType = (types: string[], values: string[]) =>
  values.some((value) => types.includes(value))

const pickTokenColor = (types: string[], theme: CodeTheme) => {
  if (hasType(types, ["comment", "prolog", "doctype", "cdata"])) return theme.comment
  if (hasType(types, ["keyword"])) return theme.keyword
  if (hasType(types, ["type", "class-name", "generic"])) return theme.type
  if (hasType(types, ["builtin", "function", "function-variable", "method", "namespace"])) return theme.builtin
  if (hasType(types, ["string", "char", "template-string", "regex", "url", "attr-value"])) return theme.string
  if (hasType(types, ["number", "boolean", "constant", "symbol"])) return theme.number
  if (hasType(types, ["operator", "punctuation", "tag", "attr-name"])) return theme.punctuation
  return theme.base
}

const prismTokensToLineTokens = (
  source: PrismTokenValue[],
  theme: CodeTheme,
): Token[][] => {
  const chunks = flattenPrismTokens(source)
  const lines: Token[][] = [[]]

  for (const chunk of chunks) {
    const color = pickTokenColor(chunk.types, theme)
    const pieces = chunk.text.split("\n")

    for (let i = 0; i < pieces.length; i += 1) {
      const text = pieces[i]
      if (text.length > 0) {
        lines[lines.length - 1].push({ text, color })
      }
      if (i < pieces.length - 1) {
        lines.push([])
      }
    }
  }

  return lines
}

const parseStep = (step: CodeStep, theme: CodeTheme): ParsedStep => {
  const code = step.code.replace(/\r\n/g, "\n")
  const lines = code.split("\n")
  const grammar = resolvePrismGrammar(step.language)

  if (!grammar) {
    return {
      lines,
      tokens: lines.map((line) => [{ text: line, color: theme.base }]),
    }
  }

  const rawTokens = Prism.tokenize(code, grammar)
  const tokens = prismTokensToLineTokens(rawTokens, theme)

  if (tokens.length < lines.length) {
    while (tokens.length < lines.length) {
      tokens.push([])
    }
  } else if (tokens.length > lines.length) {
    tokens.length = lines.length
  }

  return { lines, tokens }
}

const buildLineMatches = (fromLines: string[], toLines: string[]) => {
  const rows = fromLines.length
  const cols = toLines.length
  const dp: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array<number>(cols + 1).fill(0),
  )

  for (let i = 1; i <= rows; i += 1) {
    for (let j = 1; j <= cols; j += 1) {
      if (fromLines[i - 1] === toLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const matches: Array<{ from: number; to: number }> = []
  let i = rows
  let j = cols
  while (i > 0 && j > 0) {
    if (fromLines[i - 1] === toLines[j - 1]) {
      matches.push({ from: i - 1, to: j - 1 })
      i -= 1
      j -= 1
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1
    } else {
      j -= 1
    }
  }

  return matches.reverse()
}

const resolveLineHeight = (fontSize: number, lineHeight?: number) => {
  if (!lineHeight) return fontSize * 1.6
  if (lineHeight > 4) return lineHeight
  return fontSize * lineHeight
}

const resolvePadding = (padding?: HighlightPadding) => {
  if (!padding) return { x: 8, y: 2 }
  if (typeof padding === "number") return { x: padding, y: padding }
  return { x: padding.x ?? 0, y: padding.y ?? 0 }
}

const countColumns = (line: string, endIndex: number, tabSize: number) => {
  let count = 0
  for (let i = 0; i < endIndex && i < line.length; i += 1) {
    count += line[i] === "\t" ? tabSize : 1
  }
  return count
}

const findLineIndex = (offsets: number[], index: number) => {
  for (let i = offsets.length - 1; i >= 0; i -= 1) {
    if (index >= offsets[i]) return i
  }
  return 0
}

const findFragmentBox = (
  lines: string[],
  match: string,
  occurrence: number,
  ignoreWhitespace: boolean,
  tabSize: number,
) => {
  if (!match) return null
  const fullText = lines.join("\n")
  const offsets: number[] = []
  let offset = 0
  for (const line of lines) {
    offsets.push(offset)
    offset += line.length + 1
  }

  let normalized = ""
  const map: number[] = []
  for (let i = 0; i < fullText.length; i += 1) {
    const ch = fullText[i]
    if (ignoreWhitespace && /\s/.test(ch)) continue
    normalized += ch
    map.push(i)
  }

  const normalizedMatch = ignoreWhitespace ? match.replace(/\s+/g, "") : match
  if (!normalizedMatch) return null

  let startNorm = -1
  let cursor = 0
  for (let i = 0; i <= occurrence; i += 1) {
    startNorm = normalized.indexOf(normalizedMatch, cursor)
    if (startNorm === -1) return null
    cursor = startNorm + 1
  }

  let minLine = Number.POSITIVE_INFINITY
  let maxLine = Number.NEGATIVE_INFINITY
  let minColumn = Number.POSITIVE_INFINITY
  let maxColumn = Number.NEGATIVE_INFINITY

  for (let i = 0; i < normalizedMatch.length; i += 1) {
    const originalIndex = map[startNorm + i]
    if (originalIndex == null) continue
    if (fullText[originalIndex] === "\n") continue
    const lineIndex = findLineIndex(offsets, originalIndex)
    const line = lines[lineIndex] ?? ""
    const columnIndex = Math.max(0, originalIndex - offsets[lineIndex])
    const column = countColumns(line, columnIndex, tabSize)
    minLine = Math.min(minLine, lineIndex)
    maxLine = Math.max(maxLine, lineIndex)
    minColumn = Math.min(minColumn, column)
    maxColumn = Math.max(maxColumn, column + 1)
  }

  if (!Number.isFinite(minLine) || !Number.isFinite(minColumn)) return null

  return { startLine: minLine, endLine: maxLine, minColumn, maxColumn }
}

/**
 * Render animated, syntax-highlighted code that can morph between multiple steps.
 * 複数ステップ間で変化するシンタックスハイライト付きコードを描画します。
 */
export const Code = ({
  steps,
  step,
  highlightTracks = [],
  highlights = [],
  fontSize = 32,
  lineHeight,
  fontFamily = "'JetBrains Mono', 'Fira Code', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  padding = 24,
  charWidth,
  tabSize = 2,
  theme,
  style,
  className,
}: CodeProps) => {
  const mergedTheme = useMemo(() => ({ ...DEFAULT_THEME, ...(theme ?? {}) }), [theme])
  const parsedSteps = useMemo(
    () => steps.map((item) => parseStep(item, mergedTheme)),
    [steps, mergedTheme],
  )

  if (parsedSteps.length === 0) return null

  const resolvedStep = resolveValue(step) ?? 0
  const maxStep = Math.max(0, parsedSteps.length - 1)
  const clampedStep = clamp(resolvedStep, 0, maxStep)
  const stepIndex = Math.floor(clampedStep)
  const nextIndex = Math.min(stepIndex + 1, maxStep)
  const t = stepIndex === nextIndex ? 0 : clamp(clampedStep - stepIndex, 0, 1)

  const current = parsedSteps[stepIndex]
  const next = parsedSteps[nextIndex]
  const matches = useMemo(
    () => (stepIndex === nextIndex ? [] : buildLineMatches(current.lines, next.lines)),
    [current.lines, next.lines, stepIndex, nextIndex],
  )
  const matchFrom = new Map<number, number>()
  const matchTo = new Map<number, number>()
  matches.forEach(({ from, to }) => {
    matchFrom.set(from, to)
    matchTo.set(to, from)
  })

  const lineHeightPx = resolveLineHeight(fontSize, lineHeight)
  const measuredCharWidth = useMemo(() => {
    if (typeof document === "undefined") return null
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.font = `${fontSize}px ${fontFamily}`
    const metrics = ctx.measureText("M")
    return metrics.width
  }, [fontFamily, fontSize])
  const resolvedCharWidth = charWidth ?? measuredCharWidth ?? fontSize * 0.6

  let maxLinesAcrossSteps = 0
  let maxColumnsAcrossSteps = 0
  for (const parsed of parsedSteps) {
    maxLinesAcrossSteps = Math.max(maxLinesAcrossSteps, parsed.lines.length)
    for (const line of parsed.lines) {
      maxColumnsAcrossSteps = Math.max(
        maxColumnsAcrossSteps,
        countColumns(line, line.length, tabSize),
      )
    }
  }
  const blockHeight = padding * 2 + maxLinesAcrossSteps * lineHeightPx
  const blockWidth = padding * 2 + maxColumnsAcrossSteps * resolvedCharWidth

  const baseStyle: CSSProperties = {
    position: "relative",
    fontFamily,
    fontSize,
    lineHeight: `${lineHeightPx}px`,
    fontVariantLigatures: "none",
    color: mergedTheme.base,
    padding,
    tabSize,
    height: blockHeight,
    width: blockWidth,
  }

  type LineRender = {
    key: string
    tokens: Token[]
    from: number
    to: number
    opacity: number
  }

  const lineRenders: LineRender[] = []
  const addLine = (
    key: string,
    tokens: Token[],
    from: number,
    to: number,
    opacity: number,
  ) => {
    lineRenders.push({ key, tokens, from, to, opacity })
  }

  if (stepIndex === nextIndex) {
    current.tokens.forEach((tokens, index) => {
      addLine(`line-${stepIndex}-${index}`, tokens, index, index, 1)
    })
  } else {
    current.tokens.forEach((tokens, index) => {
      const mapped = matchFrom.get(index)
      if (mapped == null) {
        addLine(`line-out-${stepIndex}-${index}`, tokens, index, index, 1 - t)
      } else {
        addLine(`line-move-${stepIndex}-${index}-${mapped}`, tokens, index, mapped, 1)
      }
    })
    next.tokens.forEach((tokens, index) => {
      if (matchTo.has(index)) return
      addLine(`line-in-${nextIndex}-${index}`, tokens, index, index, t)
    })
  }

  const resolveHighlightBox = (entry: CodeHighlightStep | undefined) => {
    if (!entry) return null
    const codeStepIndex = Math.min(
      Math.max(0, entry.codeStep ?? stepIndex),
      parsedSteps.length - 1,
    )
    const targetLines = parsedSteps[codeStepIndex]?.lines ?? []
    const range = findFragmentBox(
      targetLines,
      entry.match,
      entry.occurrence ?? 0,
      entry.ignoreWhitespace !== false,
      tabSize,
    )
    if (!range) return null

    const startLine = range.startLine
    const endLine = range.endLine
    const startColumn = range.minColumn
    const endColumn = range.maxColumn
    const paddingPx = resolvePadding(entry.padding)

    const widthColumns = Math.max(1, endColumn - startColumn)
    return {
      x: startColumn * resolvedCharWidth - paddingPx.x,
      y: startLine * lineHeightPx - paddingPx.y,
      width: widthColumns * resolvedCharWidth + paddingPx.x * 2,
      height: (endLine - startLine + 1) * lineHeightPx + paddingPx.y * 2,
      entry,
    }
  }

  const resolveTrackHighlightBox = (track: CodeHighlightTrack) => {
    const trackStepValue = resolveValue(track.step) ?? 0
    const highlightMax = Math.max(0, track.steps.length - 1)
    const highlightIndex = clamp(trackStepValue, 0, highlightMax)
    const highlightFrom = Math.floor(highlightIndex)
    const highlightTo = Math.min(highlightFrom + 1, highlightMax)
    const highlightT =
      highlightFrom === highlightTo
        ? 0
        : clamp(highlightIndex - highlightFrom, 0, 1)

    const highlightFromBox = resolveHighlightBox(track.steps[highlightFrom])
    const highlightToBox = resolveHighlightBox(track.steps[highlightTo])

    if (!highlightFromBox && !highlightToBox) return null
    const fromBox = highlightFromBox ?? highlightToBox
    const toBox = highlightToBox ?? highlightFromBox
    if (!fromBox || !toBox) return null
    const fromColor = fromBox.entry?.color ?? DEFAULT_HIGHLIGHT_COLOR
    const toColor = toBox.entry?.color ?? DEFAULT_HIGHLIGHT_COLOR
    const fromFillColor = resolveHighlightFillColor(fromBox.entry?.fillColor, fromColor)
    const toFillColor = resolveHighlightFillColor(toBox.entry?.fillColor, toColor)

    return {
      id: track.id ?? track.steps[highlightFrom]?.id,
      x: fromBox.x + (toBox.x - fromBox.x) * highlightT,
      y: fromBox.y + (toBox.y - fromBox.y) * highlightT,
      width: fromBox.width + (toBox.width - fromBox.width) * highlightT,
      height: fromBox.height + (toBox.height - fromBox.height) * highlightT,
      entry: highlightT < 0.5 ? fromBox.entry : toBox.entry,
      color: interpolateColor(fromColor, toColor, highlightT),
      fillColor: interpolateColor(fromFillColor, toFillColor, highlightT),
      opacity:
        highlightFromBox && highlightToBox
          ? 1
          : highlightFromBox
            ? 1 - highlightT
            : highlightT,
    }
  }

  const highlightBoxes = highlightTracks
    .map((track) => resolveTrackHighlightBox(track))
    .filter((box): box is NonNullable<typeof box> => Boolean(box))

  return (
    <div className={className} style={style ? { ...baseStyle, ...style } : baseStyle}>
      {lineRenders.map((line) => {
        const fromY = line.from * lineHeightPx
        const toY = line.to * lineHeightPx
        // レンダー安定化: headless では 3D transform より top/left の方が欠落しにくい。
        // Render stability: in headless capture, top/left is more reliable than 3D transforms.
        const y = snapToDevicePixel(fromY + (toY - fromY) * t)
        return (
          <div
            key={line.key}
            style={{
              position: "absolute",
              left: padding,
              top: padding + y,
              opacity: clampNumber(line.opacity, 0),
              whiteSpace: "pre",
              display: "block",
            }}
          >
            {line.tokens.map((token, idx) => (
              <span key={idx} style={{ color: token.color }}>
                {token.text}
              </span>
            ))}
          </div>
        )
      })}
      {highlightBoxes.map((highlightBox, index) => (
        (() => {
          const strokeWidth = Math.max(0.5, highlightBox.entry?.strokeWidth ?? 3)
          const rect = resolveHighlightRect(
            padding + highlightBox.x,
            padding + highlightBox.y,
            Math.max(0, highlightBox.width),
            Math.max(0, highlightBox.height),
            strokeWidth,
          )

          return (
            <div
              key={highlightBox.id ?? `auto-highlight-${index}`}
              style={{
                position: "absolute",
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                // 枠安定化: 合成依存の box-shadow ではなく border を使う。
                // Stroke stability: use border instead of compositor-heavy box-shadow.
                border: `${strokeWidth}px solid ${highlightBox.color}`,
                borderRadius: highlightBox.entry?.radius ?? 10,
                background: highlightBox.fillColor,
                opacity: clampNumber(highlightBox.opacity, 1),
                pointerEvents: "none",
                boxSizing: "border-box",
                overflow: "hidden",
              }}
            />
          )
        })()
      ))}
      {highlights.map((highlight, index) => {
        const pos = resolveValue(highlight.position)
        const size = resolveValue(highlight.size)
        const opacity = resolveValue(highlight.opacity)
        const range = highlight.range

        const fallbackPos = range
          ? {
              x: (range.start - 1) * resolvedCharWidth,
              y: (range.line - 1) * lineHeightPx,
            }
          : { x: 0, y: 0 }

        const fallbackSize = range
          ? {
              x: Math.max(0, range.end - range.start + 1) * resolvedCharWidth,
              y: lineHeightPx,
            }
          : { x: 0, y: 0 }

        const resolvedPos = pos ?? fallbackPos
        const resolvedSize = size ?? fallbackSize
        const strokeColor = highlight.color ?? DEFAULT_HIGHLIGHT_COLOR
        const fillColor = resolveHighlightFillColor(highlight.fillColor, strokeColor)
        const strokeWidth = Math.max(0.5, highlight.strokeWidth ?? 3)
        const rect = resolveHighlightRect(
          padding + resolvedPos.x,
          padding + resolvedPos.y,
          Math.max(0, resolvedSize.x),
          Math.max(0, resolvedSize.y),
          strokeWidth,
        )

        return (
          <div
            key={highlight.id ?? `highlight-${index}`}
            style={{
              position: "absolute",
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              // 枠安定化: 合成依存の box-shadow ではなく border を使う。
              // Stroke stability: use border instead of compositor-heavy box-shadow.
              border: `${strokeWidth}px solid ${strokeColor}`,
              borderRadius: highlight.radius ?? 10,
              background: fillColor,
              opacity: opacity == null ? 1 : clampNumber(opacity, 1),
              pointerEvents: "none",
              boxSizing: "border-box",
              overflow: "hidden",
            }}
          />
        )
      })}
    </div>
  )
}
