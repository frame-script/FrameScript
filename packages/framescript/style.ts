/**
 * CSS-like styles, sent to AntiWebUI as numbered properties.
 *
 * Keys are CSS properties in camelCase. Numbers are logical pixels, as in React. Any value, or the
 * whole style, can be a function: it is then followed, and only that property is sent again when
 * it changes.
 *
 * ```tsx
 * <div style={{ padding: "8px 16px", opacity: fade, transform: () => `rotate(${spin()}deg)` }} />
 * ```
 */

import * as cmd from "./internal/commands.ts"
import { parseColor } from "./color.ts"
import { createRenderEffect, untrack } from "./reactive.ts"
import * as log from "./internal/log.ts"

type Value = string | number | boolean | null | undefined
type MaybeAccessor<T> = T | (() => T)

export interface CSSProperties {
  display?: "flex" | "block" | "none" | "contents"
  /** As in CSS for what goes over what; `relative` doesn't move anything with `top` / `left`. */
  position?: "static" | "relative" | "absolute"
  flexDirection?: "row" | "column" | "row-reverse" | "column-reverse"
  flexWrap?: "nowrap" | "wrap" | "wrap-reverse"
  flex?: number | string
  flexGrow?: number
  flexShrink?: number
  flexBasis?: number | string
  justifyContent?: string
  alignItems?: string
  alignContent?: string
  alignSelf?: string
  gap?: number | string
  rowGap?: number | string
  columnGap?: number | string

  width?: number | string
  height?: number | string
  minWidth?: number | string
  minHeight?: number | string
  maxWidth?: number | string
  maxHeight?: number | string
  aspectRatio?: number | string

  margin?: number | string
  marginTop?: number | string
  marginRight?: number | string
  marginBottom?: number | string
  marginLeft?: number | string
  padding?: number | string
  paddingTop?: number | string
  paddingRight?: number | string
  paddingBottom?: number | string
  paddingLeft?: number | string
  inset?: number | string
  top?: number | string
  right?: number | string
  bottom?: number | string
  left?: number | string

  border?: number | string
  borderWidth?: number | string
  borderTopWidth?: number | string
  borderRightWidth?: number | string
  borderBottomWidth?: number | string
  borderLeftWidth?: number | string
  borderColor?: string
  borderRadius?: number | string
  borderTopLeftRadius?: number | string
  borderTopRightRadius?: number | string
  borderBottomRightRadius?: number | string
  borderBottomLeftRadius?: number | string
  outline?: number | string
  outlineWidth?: number | string
  outlineOffset?: number | string
  outlineColor?: string

  background?: string
  backgroundColor?: string
  boxShadow?: string
  opacity?: number | string
  filter?: string
  backdropFilter?: string
  overflow?: "visible" | "hidden" | "scroll"
  overflowX?: "visible" | "hidden" | "scroll"
  overflowY?: "visible" | "hidden" | "scroll"
  zIndex?: number

  /** `translate(…) scale(…) rotate(…)`; the parts are applied in AntiWebUI's order whatever theirs. */
  transform?: string
  /** `10px 20px`, or `[x, y]`. */
  translate?: number | string | [number, number]
  translateX?: number | string
  translateY?: number | string
  scale?: number | string | [number, number]
  scaleX?: number
  scaleY?: number
  /** Degrees as a number, or `45deg`, `0.5turn`, `1rad`. */
  rotate?: number | string
  transformOrigin?: string

  color?: string
  fontFamily?: string
  fontSize?: number | string
  fontWeight?: number | "normal" | "bold" | string
  fontStyle?: "normal" | "italic"
  lineHeight?: number | string
  letterSpacing?: number | string
  textAlign?: "start" | "end" | "left" | "center" | "right"
  whiteSpace?: "normal" | "pre-wrap" | "pre" | "nowrap"
  textDecoration?: "none" | "underline" | "line-through" | string
  /**
   * As in CSS, `"2px 4px 8px rgba(0,0,0,.6)"`: across, down, the blur, the color; several with
   * commas, the first on top. The letters as they are painted, strokes included.
   */
  textShadow?: string
  /**
   * A line along the outlines of the letters, `"6px #000"`, half of it outside them (CSS
   * `-webkit-text-stroke`). Several, the first on top (not in CSS): `["6px #fff", "14px #000"]`
   * edges the letters in white, then in black. With `paintOrder: "stroke"`, they go under the
   * letters, which keep their shape: the edging of captions.
   */
  textStroke?: string | readonly string[]
  /** The same as `textStroke`. */
  WebkitTextStroke?: string | readonly string[]
  /** `"stroke"` (or `"stroke fill"`): the strokes of text under its letters. `"normal"`: over them. */
  paintOrder?: string

  /** How the picture of an `<img>` or a video fits its box. */
  objectFit?: "fill" | "contain" | "cover" | "none" | "scale-down"
  /** `"center"`, `"left top"`, `"20% 80%"`, `"10px 0"`. */
  objectPosition?: string
  imageRendering?: "auto" | "pixelated"

  // Shapes in an `<svg>`, which also take these as attributes. They go down to what is inside.
  /** A color, `"none"`, `"currentColor"`, a CSS `linear-gradient(…)` / `radial-gradient(…)`, or a `Gradient`. */
  fill?: Paint
  /** As `fill`. */
  stroke?: Paint
  strokeWidth?: number | string
  fillOpacity?: number | string
  strokeOpacity?: number | string
  fillRule?: "nonzero" | "evenodd"
  strokeLinecap?: "butt" | "round" | "square"
  strokeLinejoin?: "miter" | "round" | "bevel"
  strokeMiterlimit?: number
  /** `"8 4"`, `[8, 4]` or `"none"`. */
  strokeDasharray?: string | number | readonly number[]
  strokeDashoffset?: number | string
  vectorEffect?: "none" | "non-scaling-stroke"
}

/** What the inside or the outline of a shape is painted with. */
export type Paint = string | Gradient

/** A stop of a gradient: a color evenly placed, or with where it is, from 0 to 1. */
export type GradientStop = string | readonly [number, string] | { offset: number; color: string }

/**
 * A gradient, as SVG has them: from (x1, y1) to (x2, y2), or out from (fx, fy) to the circle at
 * (cx, cy) of radius r. The numbers are fractions of the box of the shape unless `units` is
 * `"userSpaceOnUse"`. `linearGradient` and `radialGradient` make them.
 */
export interface Gradient {
  readonly type: "linear" | "radial"
  readonly x1?: number
  readonly y1?: number
  readonly x2?: number
  readonly y2?: number
  readonly cx?: number
  readonly cy?: number
  readonly r?: number
  readonly fx?: number
  readonly fy?: number
  readonly stops: readonly GradientStop[]
  readonly units?: "objectBoundingBox" | "userSpaceOnUse"
  readonly spread?: "pad" | "reflect" | "repeat"
  /** As the `transform` of SVG, or the six numbers of a matrix. */
  readonly transform?: string | readonly number[]
}

export type StyleProps = {
  [K in keyof CSSProperties]?: MaybeAccessor<CSSProperties[K] | null | undefined>
}

export type StyleProp = StyleProps | (() => CSSProperties | null | undefined)

// --- The property table from Rust ---------------------------------------------------------------

const KIND_NUMBER = 0
const KIND_LENGTH = 1
const KIND_COLOR = 2
const KIND_ENUM = 3
const KIND_BOOL = 4
const KIND_SHADOWS = 5
const KIND_STRING = 6
const KIND_NUMBERS = 7

interface Prop {
  id: number
  kind: number
  choices: Map<string, number>
}

let table: Map<string, Prop> | null = null

/** Reads the table from Rust; the host does this before anything is made. */
export function loadPropertyTable(entries: [string, number, string[]][]): void {
  table = new Map(
    entries.map(([name, kind, choices], id) => [
      name,
      { id, kind, choices: new Map(choices.map((c, i) => [c, i])) },
    ]),
  )
}

function prop(name: string): Prop {
  const p = table?.get(name)
  if (!p) throw new Error(`no style property ${name} in AntiWebUI's table`)
  return p
}

// --- Writing -----------------------------------------------------------------------------------

const warned = new Set<string>()

function warn(message: string) {
  if (warned.has(message)) return
  warned.add(message)
  log.warn(message)
}

/** Sends one AntiWebUI property; `null` takes it away. */
function write(node: number, name: string, value: Value) {
  const p = prop(name)
  if (value === null || value === undefined || value === "") {
    cmd.unset(node, p.id)
    return
  }
  switch (p.kind) {
    case KIND_NUMBER: {
      const n = number(value)
      if (n === null) return invalid(name, value)
      cmd.setNumber(node, p.id, n)
      return
    }
    case KIND_LENGTH: {
      const l = length(value, name === "lineHeight")
      if (l === null) return invalid(name, value)
      cmd.setLength(node, p.id, l[0], l[1])
      return
    }
    case KIND_COLOR: {
      const c = typeof value === "string" ? parseColor(value) : null
      if (c === null) return invalid(name, value)
      cmd.setColor(node, p.id, c)
      return
    }
    case KIND_ENUM: {
      const i = p.choices.get(String(value))
      if (i === undefined) return invalid(name, value)
      cmd.setEnum(node, p.id, i)
      return
    }
    case KIND_BOOL:
      cmd.setNumber(node, p.id, value ? 1 : 0)
      return
    case KIND_SHADOWS: {
      const list = typeof value === "string" ? shadows(value) : null
      if (list === null) return invalid(name, value)
      cmd.setShadows(node, p.id, list)
      return
    }
    case KIND_STRING:
      cmd.setString(node, p.id, String(value))
      return
    case KIND_NUMBERS:
      return invalid(name, value)
  }
}

function invalid(name: string, value: Value) {
  warn(`${JSON.stringify(value)} is not a value of ${name}`)
}

/** A plain number, or one with `px` (or `deg` and friends, which are made into degrees). */
function number(value: Value): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "string") return null
  const n = Number.parseFloat(value)
  if (Number.isNaN(n)) return null
  if (value.endsWith("rad")) return (n * 180) / Math.PI
  if (value.endsWith("turn")) return n * 360
  return n
}

function length(value: Value, bareIsNumber = false): [number, number] | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null
    return [bareIsNumber ? cmd.UNIT_NUMBER : cmd.UNIT_PX, value]
  }
  if (typeof value !== "string") return null
  const v = value.trim()
  if (v === "auto" || v === "normal") return [cmd.UNIT_AUTO, 0]
  const n = Number.parseFloat(v)
  if (Number.isNaN(n)) return null
  if (v.endsWith("%")) return [cmd.UNIT_PERCENT, n]
  if (v.endsWith("px")) return [cmd.UNIT_PX, n]
  if (/^-?[\d.]+$/.test(v)) return [bareIsNumber ? cmd.UNIT_NUMBER : cmd.UNIT_PX, n]
  return null
}

/** Splits on spaces and commas that aren't inside parentheses. */
function split(value: string, separator: "," | " "): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (c === "(") depth++
    else if (c === ")") depth--
    else if (depth === 0 && (separator === " " ? /\s/.test(c) : c === ",")) {
      if (i > start) out.push(value.slice(start, i))
      start = i + 1
    }
  }
  if (start < value.length) out.push(value.slice(start))
  return out.map((s) => s.trim()).filter(Boolean)
}

/** One to four values for the top, right, bottom and left, as in CSS. */
function sides(value: Value): [Value, Value, Value, Value] {
  if (typeof value !== "string") return [value, value, value, value]
  const p = split(value, " ")
  switch (p.length) {
    case 1:
      return [p[0], p[0], p[0], p[0]]
    case 2:
      return [p[0], p[1], p[0], p[1]]
    case 3:
      return [p[0], p[1], p[2], p[1]]
    default:
      return [p[0], p[1], p[2], p[3]]
  }
}

function shadows(value: string): cmd.Shadow[] | null {
  if (value.trim() === "none") return []
  const out: cmd.Shadow[] = []
  for (const one of split(value, ",")) {
    let inset = false
    let color = 0x00000080
    const numbers: number[] = []
    for (const part of split(one, " ")) {
      if (part === "inset") inset = true
      else if (/^-?[\d.]/.test(part)) numbers.push(Number.parseFloat(part))
      else {
        const c = parseColor(part)
        if (c === null) return null
        color = c
      }
    }
    if (numbers.length < 2) return null
    out.push({ x: numbers[0], y: numbers[1], blur: numbers[2] ?? 0, spread: numbers[3] ?? 0, color, inset })
  }
  return out
}

/** `"6px #000"`, several with commas or in a list: each a width and a color (black if not given). */
function strokes(value: unknown): cmd.Shadow[] | null {
  const list = typeof value === "string" ? split(value, ",") : Array.isArray(value) ? value : null
  if (list === null) return null
  const out: cmd.Shadow[] = []
  for (const one of list) {
    if (typeof one !== "string") return null
    let width: number | null = null
    let color = 0x000000ff
    for (const part of split(one, " ")) {
      const n = /^-?[\d.]/.test(part) ? number(part) : null
      if (n !== null) width = n
      else {
        const c = parseColor(part)
        if (c === null) return null
        color = c
      }
    }
    if (width === null) return null
    out.push({ x: 0, y: 0, blur: 0, spread: width, color, inset: false })
  }
  return out
}

// --- Paint for shapes ---------------------------------------------------------------------------

/** The numbers of a paint (see `props::paint` in Rust), or null if it isn't one. */
export function paint(value: unknown): number[] | null {
  if (typeof value === "object" && value !== null && "stops" in value) return gradient(value as Gradient)
  if (typeof value !== "string") return null
  const v = value.trim()
  if (v === "none") return [0]
  if (v.toLowerCase() === "currentcolor") return [2]
  if (/gradient\(/.test(v)) {
    const g = cssGradient(v)
    return g && gradient(g)
  }
  const c = parseColor(v)
  return c === null ? null : [1, ...rgba(c)]
}

function rgba(c: number): number[] {
  return [(c >>> 24) / 255, ((c >>> 16) & 0xff) / 255, ((c >>> 8) & 0xff) / 255, (c & 0xff) / 255]
}

function gradient(g: Gradient): number[] | null {
  const spread = g.spread === "reflect" ? 1 : g.spread === "repeat" ? 2 : 0
  const units = g.units === "userSpaceOnUse" ? 1 : 0
  const out =
    g.type === "radial"
      ? [4, spread, units, g.cx ?? 0.5, g.cy ?? 0.5, g.r ?? 0.5, g.fx ?? g.cx ?? 0.5, g.fy ?? g.cy ?? 0.5]
      : [3, spread, units, g.x1 ?? 0, g.y1 ?? 0, g.x2 ?? 1, g.y2 ?? 0]
  const m = g.transform === undefined ? IDENTITY : typeof g.transform === "string" ? svgMatrix(g.transform) : g.transform
  if (m === null || m.length !== 6) return null
  out.push(...m)
  const stops = placeStops(g.stops)
  if (stops === null) return null
  for (const [offset, color] of stops) out.push(offset, ...rgba(color))
  return out
}

/** The stops with their offsets: those not given are spread evenly between those that are. */
function placeStops(stops: readonly GradientStop[]): [number, number][] | null {
  const list: [number | null, number][] = []
  for (const s of stops) {
    const [offset, color] = typeof s === "string" ? [null, s] : Array.isArray(s) ? s : [(s as { offset: number }).offset, (s as { color: string }).color]
    const c = parseColor(color as string)
    if (c === null) return null
    list.push([offset as number | null, c])
  }
  if (list.length === 0) return null
  if (list[0][0] === null) list[0][0] = 0
  if (list[list.length - 1][0] === null) list[list.length - 1][0] = 1
  let last = 0
  for (let i = 1; i < list.length; i++) {
    if (list[i][0] !== null) {
      const from = list[last][0]!
      const to = Math.max(from, list[i][0]!)
      for (let k = last + 1; k < i; k++) list[k][0] = from + ((to - from) * (k - last)) / (i - last)
      list[i][0] = to
      last = i
    }
  }
  return list as [number, number][]
}

const SIDES: Record<string, number> = {
  "to top": 0,
  "to top right": 45,
  "to right top": 45,
  "to right": 90,
  "to bottom right": 135,
  "to right bottom": 135,
  "to bottom": 180,
  "to bottom left": 225,
  "to left bottom": 225,
  "to left": 270,
  "to top left": 315,
  "to left top": 315,
}

/**
 * `linear-gradient(90deg, #f00, #00f 60%)` or `radial-gradient(circle at 30% 40%, #fff, #000)`,
 * across the box of the shape.
 */
function cssGradient(value: string): Gradient | null {
  const m = /^(repeating-)?(linear|radial)-gradient\((.*)\)$/s.exec(value)
  if (!m) return null
  const args = split(m[3], ",")
  const spread = m[1] ? "repeat" : "pad"
  let first = args[0] ?? ""
  const stopOf = (s: string): GradientStop => {
    const parts = split(s, " ")
    const at = parts.length > 1 ? parts[parts.length - 1] : null
    if (at !== null && at.endsWith("%")) return [Number.parseFloat(at) / 100, parts.slice(0, -1).join(" ")]
    return s
  }
  if (m[2] === "linear") {
    let angle = 180
    if (first in SIDES) angle = SIDES[first]
    else if (/^-?[\d.]+(deg|turn|rad|grad)$/.test(first)) angle = first.endsWith("grad") ? Number.parseFloat(first) * 0.9 : number(first)!
    else first = ""
    const stops = (first ? args.slice(1) : args).map(stopOf)
    const a = (angle * Math.PI) / 180
    const [dx, dy] = [Math.sin(a), -Math.cos(a)]
    const half = 0.5 * (Math.abs(dx) + Math.abs(dy))
    return { type: "linear", x1: 0.5 - dx * half, y1: 0.5 - dy * half, x2: 0.5 + dx * half, y2: 0.5 + dy * half, stops, spread }
  }
  let cx = 0.5
  let cy = 0.5
  const shape = /^(circle|ellipse)?\s*(closest-side|farthest-side|closest-corner|farthest-corner)?\s*(at\s+(.+))?$/.exec(first)
  if (shape && first) {
    if (shape[4]) {
      const [x, y] = objectPosition(shape[4])
      cx = Number.parseFloat(x) / 100
      cy = Number.parseFloat(y) / 100
    }
    first = ""
  }
  const stops = (first ? args : args.slice(1)).map(stopOf)
  return { type: "radial", cx, cy, r: 0.5, stops, spread }
}

/** `"8 4"`, `[8, 4]`, `8` or `"none"`: no numbers for none. */
export function dashes(value: unknown): number[] | null {
  if (typeof value === "number") return [value]
  if (Array.isArray(value)) return value.every((n) => typeof n === "number") ? value : null
  if (typeof value !== "string") return null
  if (value.trim() === "none") return []
  const list = value.split(/[\s,]+/).filter(Boolean).map(Number.parseFloat)
  return list.some(Number.isNaN) ? null : list
}

const IDENTITY = [1, 0, 0, 1, 0, 0]

function multiply(m: readonly number[], n: readonly number[]): number[] {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

/**
 * The matrix `a b c d e f` of an SVG `transform`: `translate(10 20) rotate(45 50 50) scale(2)
 * skewX(10) matrix(…)`, applied right to left as in SVG.
 */
export function svgMatrix(value: string): number[] | null {
  let m = IDENTITY
  for (const f of value.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const a = f[2].split(/[\s,]+/).filter(Boolean).map(Number.parseFloat)
    if (a.some(Number.isNaN)) return null
    const rad = (d: number) => (d * Math.PI) / 180
    let n: number[]
    switch (f[1]) {
      case "matrix":
        if (a.length !== 6) return null
        n = a
        break
      case "translate":
        n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]
        break
      case "scale":
        n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]
        break
      case "rotate": {
        const [cos, sin] = [Math.cos(rad(a[0] ?? 0)), Math.sin(rad(a[0] ?? 0))]
        const [x, y] = [a[1] ?? 0, a[2] ?? 0]
        n = [cos, sin, -sin, cos, x - cos * x + sin * y, y - sin * x - cos * y]
        break
      }
      case "skewX":
        n = [1, 0, Math.tan(rad(a[0] ?? 0)), 1, 0, 0]
        break
      case "skewY":
        n = [1, Math.tan(rad(a[0] ?? 0)), 0, 1, 0, 0]
        break
      default:
        return null
    }
    m = multiply(m, n)
  }
  return m
}

const ALIGN_ALIASES: Record<string, string> = {
  "flex-start": "start",
  "flex-end": "end",
  "self-start": "start",
  "self-end": "end",
  left: "start",
  right: "end",
  normal: "stretch",
}

function align(value: Value): Value {
  if (typeof value !== "string") return value
  if (value === "baseline") {
    warn("baseline alignment is not supported; start is used instead")
    return "start"
  }
  return ALIGN_ALIASES[value] ?? value
}

const ORIGIN: Record<string, [number | null, number | null]> = {
  left: [0, null],
  right: [1, null],
  top: [null, 0],
  bottom: [null, 1],
  center: [null, null],
}

function transformOrigin(value: string): [number, number] {
  let x = 0.5
  let y = 0.5
  const parts = split(value, " ")
  parts.forEach((part, i) => {
    const keyword = ORIGIN[part]
    if (keyword) {
      if (keyword[0] !== null) x = keyword[0]
      if (keyword[1] !== null) y = keyword[1]
      return
    }
    const n = Number.parseFloat(part)
    if (Number.isNaN(n)) return
    const fraction = part.endsWith("%") ? n / 100 : n
    if (i === 0) x = fraction
    else y = fraction
  })
  return [x, y]
}

const POSITION: Record<string, [string | null, string | null]> = {
  left: ["0%", null],
  right: ["100%", null],
  top: [null, "0%"],
  bottom: [null, "100%"],
  center: [null, null],
}

/** The two halves of `object-position`, as lengths. */
function objectPosition(value: string): [string, string] {
  let x = "50%"
  let y = "50%"
  split(value, " ").forEach((part, i) => {
    const keyword = POSITION[part]
    if (keyword) {
      if (keyword[0] !== null) x = keyword[0]
      if (keyword[1] !== null) y = keyword[1]
    } else if (i === 0) {
      x = part
    } else {
      y = part
    }
  })
  return [x, y]
}

interface Transform {
  translateX?: Value
  translateY?: Value
  scaleX?: Value
  scaleY?: Value
  rotate?: Value
}

function parseTransform(value: string): Transform {
  const out: Transform = {}
  for (const m of value.matchAll(/([a-zA-Z0-9]+)\(([^)]*)\)/g)) {
    const args = split(m[2], ",").flatMap((a) => split(a, " "))
    switch (m[1]) {
      case "translate":
        out.translateX = args[0]
        out.translateY = args[1] ?? 0
        break
      case "translateX":
        out.translateX = args[0]
        break
      case "translateY":
        out.translateY = args[0]
        break
      case "scale":
        out.scaleX = args[0]
        out.scaleY = args[1] ?? args[0]
        break
      case "scaleX":
        out.scaleX = args[0]
        break
      case "scaleY":
        out.scaleY = args[0]
        break
      case "rotate":
      case "rotateZ":
        out.rotate = args[0]
        break
      default:
        warn(`transform function ${m[1]} is not supported`)
    }
  }
  return out
}

function pair(value: unknown): [Value, Value] {
  if (Array.isArray(value)) return [value[0], value[1] ?? value[0]]
  if (typeof value === "string") {
    const p = split(value, " ")
    return [p[0], p[1] ?? p[0]]
  }
  return [value as Value, value as Value]
}

function blurOf(value: Value): Value {
  if (typeof value !== "string") return value
  if (value.trim() === "none") return null
  const m = /blur\(([^)]*)\)/.exec(value)
  if (!m) {
    warn(`only blur() is supported in filters, not ${value}`)
    return null
  }
  return m[1]
}

/**
 * Sends a CSS property, which may stand for several of AntiWebUI's. `null` and `undefined` take it
 * away.
 */
export function setStyle(node: number, key: string, value: unknown): void {
  const v = value as Value
  switch (key) {
    case "background":
    case "backgroundColor":
      if (typeof v === "string" && /gradient\(|url\(/.test(v)) {
        warn("only colors are supported for backgrounds so far")
        return
      }
      return write(node, "backgroundColor", v)
    case "padding": {
      const [t, r, b, l] = sides(v)
      write(node, "paddingTop", t)
      write(node, "paddingRight", r)
      write(node, "paddingBottom", b)
      write(node, "paddingLeft", l)
      return
    }
    case "margin": {
      const [t, r, b, l] = sides(v)
      write(node, "marginTop", t)
      write(node, "marginRight", r)
      write(node, "marginBottom", b)
      write(node, "marginLeft", l)
      return
    }
    case "inset": {
      const [t, r, b, l] = sides(v)
      write(node, "top", t)
      write(node, "right", r)
      write(node, "bottom", b)
      write(node, "left", l)
      return
    }
    case "borderWidth": {
      const [t, r, b, l] = sides(v)
      write(node, "borderTopWidth", t)
      write(node, "borderRightWidth", r)
      write(node, "borderBottomWidth", b)
      write(node, "borderLeftWidth", l)
      return
    }
    case "borderRadius": {
      const [tl, tr, br, bl] = sides(v)
      write(node, "borderTopLeftRadius", tl)
      write(node, "borderTopRightRadius", tr)
      write(node, "borderBottomRightRadius", br)
      write(node, "borderBottomLeftRadius", bl)
      return
    }
    case "border":
    case "outline": {
      let width: Value = v
      let color: Value = null
      if (typeof v === "string") {
        width = null
        for (const part of split(v, " ")) {
          if (/^-?[\d.]/.test(part)) width = part
          else if (part !== "solid" && part !== "none") color = part
        }
      }
      if (key === "border") {
        setStyle(node, "borderWidth", width)
        write(node, "borderColor", color)
      } else {
        write(node, "outlineWidth", width)
        write(node, "outlineColor", color)
      }
      return
    }
    case "gap": {
      const [row, column] = pair(v)
      write(node, "rowGap", row)
      write(node, "columnGap", column)
      return
    }
    case "flex": {
      if (v === null || v === undefined) {
        write(node, "flexGrow", null)
        write(node, "flexShrink", null)
        write(node, "flexBasis", null)
      } else if (v === "none") {
        write(node, "flexGrow", 0)
        write(node, "flexShrink", 0)
        write(node, "flexBasis", "auto")
      } else if (v === "auto") {
        write(node, "flexGrow", 1)
        write(node, "flexShrink", 1)
        write(node, "flexBasis", "auto")
      } else {
        const p = typeof v === "string" ? split(v, " ") : [v]
        write(node, "flexGrow", p[0])
        write(node, "flexShrink", p[1] ?? 1)
        write(node, "flexBasis", p[2] ?? "0%")
      }
      return
    }
    case "overflow":
      write(node, "overflowX", v)
      write(node, "overflowY", v)
      return
    case "justifyContent":
    case "alignItems":
    case "alignContent":
    case "alignSelf":
      return write(node, key, align(v))
    case "aspectRatio": {
      if (typeof v === "string" && v.includes("/")) {
        const [w, h] = v.split("/").map((s) => Number.parseFloat(s))
        return write(node, key, w / h)
      }
      return write(node, key, v)
    }
    case "opacity":
      return write(node, key, typeof v === "string" && v.endsWith("%") ? Number.parseFloat(v) / 100 : v)
    case "filter":
      return write(node, "blur", blurOf(v))
    case "backdropFilter":
      return write(node, "backdropBlur", blurOf(v))
    case "transform": {
      const t = typeof v === "string" ? parseTransform(v) : {}
      write(node, "translateX", t.translateX)
      write(node, "translateY", t.translateY)
      write(node, "scaleX", t.scaleX)
      write(node, "scaleY", t.scaleY)
      write(node, "rotate", t.rotate)
      return
    }
    case "translate": {
      const [x, y] = v === null || v === undefined ? [null, null] : pair(v)
      write(node, "translateX", x)
      write(node, "translateY", y)
      return
    }
    case "scale": {
      const [x, y] = v === null || v === undefined ? [null, null] : pair(v)
      write(node, "scaleX", x)
      write(node, "scaleY", y)
      return
    }
    case "transformOrigin": {
      const [x, y] = typeof v === "string" ? transformOrigin(v) : [null, null]
      write(node, "transformOriginX", x)
      write(node, "transformOriginY", y)
      return
    }
    case "objectPosition": {
      const [x, y] = typeof v === "string" ? objectPosition(v) : [null, null]
      write(node, "objectPositionX", x)
      write(node, "objectPositionY", y)
      return
    }
    case "fontWeight": {
      const named: Record<string, number> = { normal: 400, bold: 700, lighter: 300, bolder: 700 }
      return write(node, key, typeof v === "string" && v in named ? named[v] : v)
    }
    case "whiteSpace":
      return write(node, key, v === "nowrap" ? "pre" : v === "normal" ? "pre-wrap" : v)
    case "textDecoration": {
      const s = typeof v === "string" ? v : ""
      write(node, "underline", v === null || v === undefined ? null : s.includes("underline"))
      write(node, "strikethrough", v === null || v === undefined ? null : s.includes("line-through"))
      return
    }
    case "textStroke":
    case "WebkitTextStroke": {
      if (value === null || value === undefined || value === "") return write(node, "textStroke", null)
      const list = strokes(value)
      if (list === null) return invalid(key, v)
      cmd.setShadows(node, prop("textStroke").id, list)
      return
    }
    case "paintOrder": {
      if (typeof v !== "string") return write(node, key, v)
      // The strokes come first if they are named before the letters, which go last if not named.
      const parts = v.trim().split(/\s+/)
      const stroke = parts.indexOf("stroke")
      const fill = parts.indexOf("fill")
      return write(node, key, stroke >= 0 && (fill < 0 || stroke < fill) ? "stroke" : "normal")
    }
    case "fill":
    case "stroke": {
      if (value === null || value === undefined || value === "") return write(node, key, null)
      const p = paint(value)
      if (p === null) return invalid(key, v)
      cmd.setNumbers(node, prop(key).id, p)
      return
    }
    case "strokeDasharray": {
      if (value === null || value === undefined || value === "") return write(node, key, null)
      const list = dashes(value)
      if (list === null) return invalid(key, v)
      cmd.setNumbers(node, prop(key).id, list)
      return
    }
    case "fillOpacity":
    case "strokeOpacity":
      return write(node, key, typeof v === "string" && v.endsWith("%") ? Number.parseFloat(v) / 100 : v)
    case "position":
      if (v === "fixed" || v === "sticky") {
        warn(`position: ${v} is not supported; absolute is used instead`)
        return write(node, key, "absolute")
      }
      return write(node, key, v)
    default:
      if (!table?.has(key)) {
        warn(`style property ${key} is not supported`)
        return
      }
      return write(node, key, v)
  }
}

/** Applies `style` to `node`, following what is given as functions. */
export function bindStyle(node: number, style: StyleProp): void {
  if (typeof style === "function") {
    let previous: Record<string, unknown> = {}
    createRenderEffect(() => {
      const next = (style() ?? {}) as Record<string, unknown>
      untrack(() => {
        for (const key in previous) if (!(key in next)) setStyle(node, key, null)
        for (const key in next) if (next[key] !== previous[key]) setStyle(node, key, next[key])
      })
      previous = next
    })
    return
  }
  for (const key in style) {
    const value = (style as Record<string, unknown>)[key]
    if (typeof value === "function") {
      createRenderEffect(() => {
        const v = (value as () => unknown)()
        untrack(() => setStyle(node, key, v))
      })
    } else {
      setStyle(node, key, value)
    }
  }
}
