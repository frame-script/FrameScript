/**
 * Vector drawing: `<svg>` and the shapes in it, drawn by AntiWebUI (see its
 * `docs/design/25-svg.md`). As in HTML, with every attribute able to be a function, which is then
 * followed:
 *
 * ```tsx
 * <svg viewBox="0 0 200 200" style={{ width: 400, height: 400 }}>
 *   <g transform={() => `rotate(${spin()} 100 100)`} stroke="#38bdf8" strokeWidth={6} fill="none">
 *     <circle cx={100} cy={100} r={radius} trim={() => [0, drawn()]} strokeLinecap="round" />
 *     <path d={() => star(5, 80, 40)} fill="linear-gradient(90deg, #f472b6, #a855f7)" />
 *   </g>
 * </svg>
 * ```
 *
 * `trim` is FrameScript's own: the part of the outline from one fraction of its length to another
 * (After Effects' Trim Paths). Past 1 it goes round again from the start, so `[0.8, 1.1]` of a
 * closed shape is drawn across where it starts.
 */

import * as cmd from "./internal/commands.ts"
import { Host, type JSXNode } from "./jsx.ts"
import { createRenderEffect, onCleanup, untrack } from "./reactive.ts"
import { bindStyle, type CSSProperties, type Gradient, type GradientStop, type Paint, type StyleProps, svgMatrix } from "./style.ts"
import * as log from "./internal/log.ts"

type MaybeAccessor<T> = T | (() => T)

function read<T>(value: MaybeAccessor<T>): T {
  return typeof value === "function" ? (value as () => T)() : value
}

/** What `fill`, `stroke` and the rest are, as attributes; they go down to the shapes inside. */
export interface Presentation {
  fill?: MaybeAccessor<Paint | null | undefined>
  stroke?: MaybeAccessor<Paint | null | undefined>
  strokeWidth?: MaybeAccessor<number | string | undefined>
  fillOpacity?: MaybeAccessor<number | string | undefined>
  strokeOpacity?: MaybeAccessor<number | string | undefined>
  opacity?: MaybeAccessor<number | string | undefined>
  fillRule?: MaybeAccessor<CSSProperties["fillRule"]>
  strokeLinecap?: MaybeAccessor<CSSProperties["strokeLinecap"]>
  strokeLinejoin?: MaybeAccessor<CSSProperties["strokeLinejoin"]>
  strokeMiterlimit?: MaybeAccessor<number | undefined>
  strokeDasharray?: MaybeAccessor<CSSProperties["strokeDasharray"]>
  strokeDashoffset?: MaybeAccessor<number | string | undefined>
  vectorEffect?: MaybeAccessor<CSSProperties["vectorEffect"]>
  /** Blur, as CSS `filter: blur(…)`: of a shape, a group or the whole. */
  filter?: MaybeAccessor<string | undefined>
  style?: StyleProps
  ref?: (node: number) => void
}

const PRESENTATION = [
  "fill",
  "stroke",
  "strokeWidth",
  "fillOpacity",
  "strokeOpacity",
  "opacity",
  "fillRule",
  "strokeLinecap",
  "strokeLinejoin",
  "strokeMiterlimit",
  "strokeDasharray",
  "strokeDashoffset",
  "vectorEffect",
  "filter",
] as const

export interface SvgProps extends Presentation {
  /** `"0 0 100 100"` or `[0, 0, 100, 100]`: what shows in the box. Without it, logical pixels. */
  viewBox?: MaybeAccessor<string | readonly number[] | undefined>
  /** `"xMidYMid meet"` (the default), `"xMinYMax slice"`, `"none"`… */
  preserveAspectRatio?: MaybeAccessor<string | undefined>
  /** The size of the box, as in the style. */
  width?: MaybeAccessor<number | string | undefined>
  height?: MaybeAccessor<number | string | undefined>
  children?: JSXNode
}

export interface GroupProps extends Presentation {
  /** As the `transform` of SVG, or the six numbers of a matrix. */
  transform?: MaybeAccessor<string | readonly number[] | undefined>
  /** `[x, y, width, height]`: what is inside is cut to this rectangle, in its coordinates. */
  clip?: MaybeAccessor<readonly number[] | undefined>
  children?: JSXNode
}

export interface ShapeProps extends Presentation {
  transform?: MaybeAccessor<string | readonly number[] | undefined>
  /** How long to take it to be when measuring dashes along it, as in SVG. */
  pathLength?: MaybeAccessor<number | undefined>
  /** The part of the outline that is stroked, from one fraction of its length to another. */
  trim?: MaybeAccessor<readonly [number, number] | number | undefined>
}

type N = MaybeAccessor<number | undefined>

export interface PathProps extends ShapeProps {
  d: MaybeAccessor<string>
}
export interface CircleProps extends ShapeProps {
  cx?: N
  cy?: N
  r: N
}
export interface EllipseProps extends ShapeProps {
  cx?: N
  cy?: N
  rx: N
  ry: N
}
export interface RectProps extends ShapeProps {
  x?: N
  y?: N
  width: N
  height: N
  rx?: N
  ry?: N
}
export interface LineProps extends ShapeProps {
  x1?: N
  y1?: N
  x2?: N
  y2?: N
}
export interface PolyProps extends ShapeProps {
  /** `"0,0 10,20 30,5"`, `[0, 0, 10, 20]` or `[[0, 0], [10, 20]]`. */
  points: MaybeAccessor<string | readonly number[] | readonly (readonly [number, number])[]>
}

/** Makes `<svg>`, `<g>` or a shape. */
export function svgElement(type: string, props: Record<string, unknown>): number {
  switch (type) {
    case "svg":
      return svgBox(props as SvgProps)
    case "g":
      return group(props as GroupProps)
    case "path":
      return shape(props as ShapeProps, () => read((props as unknown as PathProps).d) ?? "")
    case "circle": {
      const p = props as unknown as CircleProps
      return shape(p, () => ellipsePath(num(p.cx), num(p.cy), num(p.r), num(p.r)))
    }
    case "ellipse": {
      const p = props as unknown as EllipseProps
      return shape(p, () => ellipsePath(num(p.cx), num(p.cy), num(p.rx), num(p.ry)))
    }
    case "rect": {
      const p = props as unknown as RectProps
      return shape(p, () => {
        const rx = p.rx === undefined ? p.ry : p.rx
        const ry = p.ry === undefined ? p.rx : p.ry
        return rectPath(num(p.x), num(p.y), num(p.width), num(p.height), num(rx), num(ry))
      })
    }
    case "line": {
      const p = props as unknown as LineProps
      return shape(p, () => `M${num(p.x1)} ${num(p.y1)}L${num(p.x2)} ${num(p.y2)}`)
    }
    case "polyline":
    case "polygon": {
      const p = props as unknown as PolyProps
      return shape(p, () => polyPath(read(p.points), type === "polygon"))
    }
  }
  throw new TypeError(`<${type}> is not an element of FrameScript`)
}

export const SVG_ELEMENTS = new Set(["svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon"])

function num(value: N): number {
  const n = read(value)
  return typeof n === "number" && Number.isFinite(n) ? n : 0
}

/** The attributes and the style of an element, as one style: the style wins, as in a browser. */
function styleOf(props: Presentation, extra: StyleProps = {}): StyleProps {
  const style: Record<string, unknown> = { ...extra }
  for (const key of PRESENTATION) if (props[key] !== undefined) style[key] = props[key]
  return { ...style, ...props.style } as StyleProps
}

function made(kind: number): number {
  const node = cmd.createNode(kind)
  onCleanup(() => cmd.removeNode(node))
  return node
}

/** Follows `value`, sending it with `send` when it changes. */
function follow<T>(value: MaybeAccessor<T>, send: (v: T) => void) {
  if (typeof value !== "function") return send(value)
  createRenderEffect(() => {
    const v = (value as () => T)()
    untrack(() => send(v))
  })
}

function svgBox(props: SvgProps): number {
  const node = made(cmd.KIND_SVG)
  const box: StyleProps = { overflow: "hidden" }
  if (props.width !== undefined) box.width = props.width
  if (props.height !== undefined) box.height = props.height
  bindStyle(node, styleOf(props, box))
  if (props.viewBox !== undefined) {
    follow(props.viewBox, (v) => {
      const box = typeof v === "string" ? v.split(/[\s,]+/).filter(Boolean).map(Number) : v ?? []
      cmd.setParam(node, cmd.P.VIEW_BOX, box.length === 4 && box.every(Number.isFinite) ? box : [])
    })
  }
  if (props.preserveAspectRatio !== undefined) {
    follow(props.preserveAspectRatio, (v) => cmd.setParam(node, cmd.P.ASPECT, aspect(v ?? "")))
  }
  new Host(node).mount(props.children)
  props.ref?.(node)
  return node
}

/** `xMidYMid meet` as the alignment and whether it slices. */
function aspect(value: string): number[] {
  const [align, mode] = value.trim().split(/\s+/)
  if (align === "none") return [Number.NaN, 0, 0]
  const m = /^x(Min|Mid|Max)Y(Min|Mid|Max)$/.exec(align ?? "")
  const at = { Min: 0, Mid: 0.5, Max: 1 } as const
  return [m ? at[m[1] as "Min"] : 0.5, m ? at[m[2] as "Min"] : 0.5, mode === "slice" ? 1 : 0]
}

function bindTransform(node: number, transform: GroupProps["transform"]) {
  if (transform === undefined) return
  follow(transform, (v) => {
    const m = v === undefined ? [1, 0, 0, 1, 0, 0] : typeof v === "string" ? svgMatrix(v) : v
    if (m === null || m.length !== 6) return warnOnce(`${JSON.stringify(v)} is not a transform`)
    cmd.setParam(node, cmd.P.SHAPE_TRANSFORM, m)
  })
}

function group(props: GroupProps): number {
  const node = made(cmd.KIND_SVG_GROUP)
  bindStyle(node, styleOf(props))
  bindTransform(node, props.transform)
  if (props.clip !== undefined) follow(props.clip, (v) => cmd.setParam(node, cmd.P.CLIP, v ?? []))
  new Host(node).mount(props.children)
  props.ref?.(node)
  return node
}

function shape(props: ShapeProps, d: () => string): number {
  const node = made(cmd.KIND_SHAPE)
  const style = styleOf(props)
  if (props.trim !== undefined) {
    const length = () => {
      const l = read(props.pathLength)
      return typeof l === "number" && l > 0 ? l : 1
    }
    const part = () => trimmed(read(props.trim))
    const stroke = style.stroke
    // A trim that leaves nothing strokes nothing: an empty dash would still show its caps.
    style.stroke = () => (part() === "none" ? "none" : read(stroke))
    style.strokeDasharray = () => {
      const p = part()
      return typeof p === "string" ? "none" : p.dashes.map((x) => x * length())
    }
    style.strokeDashoffset = () => {
      const p = part()
      return typeof p === "string" ? 0 : p.offset * length()
    }
    follow(length, (l) => cmd.setParam(node, cmd.P.PATH_LENGTH, [l]))
  } else if (props.pathLength !== undefined) {
    follow(props.pathLength, (l) => cmd.setParam(node, cmd.P.PATH_LENGTH, typeof l === "number" && l > 0 ? [l] : []))
  }
  bindStyle(node, style)
  bindTransform(node, props.transform)
  let last: string | null = null
  createRenderEffect(() => {
    const path = d()
    if (path === last) return
    last = path
    untrack(() => cmd.setPath(node, path))
  })
  props.ref?.(node)
  return node
}

/**
 * The dashes and their offset, in fractions of the length, that show only `[start, end]` of it:
 * `"all"` for all of it and `"none"` for none.
 */
export function trimmed(
  trim: readonly [number, number] | number | undefined,
): { dashes: number[]; offset: number } | "all" | "none" {
  if (trim === undefined) return "all"
  let [start, end] = typeof trim === "number" ? [0, trim] : trim
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "none"
  if (end < start) [start, end] = [end, start]
  if (end - start <= 1e-5) return "none"
  if (end - start >= 1) return "all"
  const turns = Math.floor(start)
  start -= turns
  end -= turns
  // One dash, with a gap that goes past the end; or, across the start, one at each end. Neither
  // starts with an empty dash, which would show its caps.
  if (end <= 1) return { dashes: [end - start, 2], offset: -start }
  return { dashes: [end - 1, start - (end - 1), 1 - start, 2], offset: 0 }
}

const warned = new Set<string>()
function warnOnce(message: string) {
  if (warned.has(message)) return
  warned.add(message)
  log.warn(message)
}

// --- Outlines ------------------------------------------------------------------------------------

/** How far along its tangent the control point of a quarter of an ellipse is, of its radius. */
const KAPPA = 0.5522847498

/**
 * A quarter of an ellipse from (x0, y0) to (x1, y1), turning about the corner (cx, cy) of the box
 * they are on (as a cubic, which is what a browser draws too; arcs whose radii just fit come out
 * wrong from the parser).
 */
function quarter(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number): string {
  const k = KAPPA
  return `C${x0 + (cx - x0) * k} ${y0 + (cy - y0) * k} ${x1 + (cx - x1) * k} ${y1 + (cy - y1) * k} ${x1} ${y1}`
}

/** Starts at the right and goes round clockwise (on the screen), as SVG's does. */
function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  if (rx <= 0 || ry <= 0) return ""
  const [l, r, t, b] = [cx - rx, cx + rx, cy - ry, cy + ry]
  return (
    `M${r} ${cy}${quarter(r, cy, cx, b, r, b)}${quarter(cx, b, l, cy, l, b)}` +
    `${quarter(l, cy, cx, t, l, t)}${quarter(cx, t, r, cy, r, t)}Z`
  )
}

/** Starts at the top left, after the corner, and goes round clockwise, as SVG's does. */
function rectPath(x: number, y: number, w: number, h: number, rx: number, ry: number): string {
  if (w <= 0 || h <= 0) return ""
  rx = Math.min(Math.max(rx, 0), w / 2)
  ry = Math.min(Math.max(ry, 0), h / 2)
  if (rx === 0 || ry === 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`
  const [r, b] = [x + w, y + h]
  return (
    `M${x + rx} ${y}H${r - rx}${quarter(r - rx, y, r, y + ry, r, y)}V${b - ry}` +
    `${quarter(r, b - ry, r - rx, b, r, b)}H${x + rx}${quarter(x + rx, b, x, b - ry, x, b)}` +
    `V${y + ry}${quarter(x, y + ry, x + rx, y, x, y)}Z`
  )
}

function polyPath(points: PolyProps["points"] extends MaybeAccessor<infer P> ? P : never, closed: boolean): string {
  let flat: number[]
  if (typeof points === "string") flat = points.split(/[\s,]+/).filter(Boolean).map(Number)
  else if (points.length > 0 && Array.isArray(points[0])) flat = (points as readonly (readonly [number, number])[]).flat()
  else flat = [...(points as readonly number[])]
  let d = ""
  for (let i = 0; i + 1 < flat.length; i += 2) d += `${i === 0 ? "M" : "L"}${flat[i]} ${flat[i + 1]}`
  return d && closed ? d + "Z" : d
}

// --- Gradients -----------------------------------------------------------------------------------

/**
 * A gradient along a line, from (x1, y1) to (x2, y2): across the box of the shape from left to
 * right unless told otherwise.
 *
 * ```tsx
 * <rect width={400} height={80} fill={linearGradient(["#38bdf8", "#a855f7"], { x2: 0, y2: 1 })} />
 * ```
 */
export function linearGradient(
  stops: readonly GradientStop[],
  options: Omit<Partial<Gradient>, "type" | "stops" | "cx" | "cy" | "r" | "fx" | "fy"> = {},
): Gradient {
  return { ...options, type: "linear", stops }
}

/** A gradient out from (fx, fy) to the circle at (cx, cy) of radius r: from the middle of the box unless told otherwise. */
export function radialGradient(
  stops: readonly GradientStop[],
  options: Omit<Partial<Gradient>, "type" | "stops" | "x1" | "y1" | "x2" | "y2"> = {},
): Gradient {
  return { ...options, type: "radial", stops }
}
