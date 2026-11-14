/**
 * CSS colors, as `0xRRGGBBAA` for the command buffer.
 *
 * `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()` / `rgba()`, `hsl()` / `hsla()` (with commas or
 * spaces and `/ alpha`), `transparent` and the common named colors.
 */

export type ColorHex = `#${string}`

export interface Rgba {
  r: number
  g: number
  b: number
  /** 0 to 1. */
  a: number
}

const NAMED: Record<string, number> = {
  transparent: 0x00000000,
  black: 0x000000ff,
  white: 0xffffffff,
  red: 0xff0000ff,
  green: 0x008000ff,
  lime: 0x00ff00ff,
  blue: 0x0000ffff,
  yellow: 0xffff00ff,
  cyan: 0x00ffffff,
  aqua: 0x00ffffff,
  magenta: 0xff00ffff,
  fuchsia: 0xff00ffff,
  gray: 0x808080ff,
  grey: 0x808080ff,
  silver: 0xc0c0c0ff,
  maroon: 0x800000ff,
  olive: 0x808000ff,
  navy: 0x000080ff,
  purple: 0x800080ff,
  teal: 0x008080ff,
  orange: 0xffa500ff,
  pink: 0xffc0cbff,
  gold: 0xffd700ff,
  indigo: 0x4b0082ff,
  violet: 0xee82eeff,
  skyblue: 0x87ceebff,
  coral: 0xff7f50ff,
  crimson: 0xdc143cff,
  tomato: 0xff6347ff,
}

const cache = new Map<string, number | null>()

/** `0xRRGGBBAA`, or `null` if it isn't a color. */
export function parseColor(value: string): number | null {
  let result = cache.get(value)
  if (result !== undefined) return result
  result = parse(value.trim().toLowerCase())
  if (cache.size > 4096) cache.clear()
  cache.set(value, result)
  return result
}

export function toRgba(packed: number): Rgba {
  return {
    r: (packed >>> 24) & 0xff,
    g: (packed >>> 16) & 0xff,
    b: (packed >>> 8) & 0xff,
    a: (packed & 0xff) / 255,
  }
}

export function fromRgba({ r, g, b, a }: Rgba): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return ((c(r) << 24) | (c(g) << 16) | (c(b) << 8) | c(a * 255)) >>> 0
}

export function toHex(packed: number, alpha = true): ColorHex {
  const hex = (packed >>> 0).toString(16).padStart(8, "0")
  return `#${alpha ? hex : hex.slice(0, 6)}`
}

/** Mixes two colors, in the gamma space colors are written in (as CSS transitions do). */
export function mixColor(from: string, to: string, t: number): ColorHex {
  const a = parseColor(from)
  const b = parseColor(to)
  if (a === null || b === null) return to as ColorHex
  const x = toRgba(a)
  const y = toRgba(b)
  const mix = (p: number, q: number) => p + (q - p) * t
  const packed = fromRgba({ r: mix(x.r, y.r), g: mix(x.g, y.g), b: mix(x.b, y.b), a: mix(x.a, y.a) })
  const opaque = (a & 0xff) === 0xff && (b & 0xff) === 0xff
  return toHex(packed, !opaque)
}

function parse(s: string): number | null {
  if (s.startsWith("#")) return parseHex(s.slice(1))
  if (s in NAMED) return NAMED[s]
  const call = /^(rgba?|hsla?)\((.*)\)$/.exec(s)
  if (!call) return null
  const parts = call[2].split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3 || parts.length > 4) return null
  const alpha = parts.length === 4 ? channel(parts[3], 1) : 1
  if (alpha === null) return null
  if (call[1].startsWith("rgb")) {
    const [r, g, b] = parts.slice(0, 3).map((p) => channel(p, 255))
    if (r === null || g === null || b === null) return null
    return fromRgba({ r, g, b, a: alpha })
  }
  const h = angle(parts[0])
  const sat = channel(parts[1], 1)
  const light = channel(parts[2], 1)
  if (h === null || sat === null || light === null) return null
  return fromRgba({ ...hslToRgb(h, sat, light), a: alpha })
}

function parseHex(hex: string): number | null {
  if (!/^[0-9a-f]+$/.test(hex)) return null
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("")
  if (hex.length === 6) hex += "ff"
  if (hex.length !== 8) return null
  return Number.parseInt(hex, 16) >>> 0
}

/** A number, or a percentage of `max`. */
function channel(p: string, max: number): number | null {
  const v = Number.parseFloat(p)
  if (Number.isNaN(v)) return null
  return p.endsWith("%") ? (v / 100) * max : v
}

/** In degrees. */
function angle(p: string): number | null {
  const v = Number.parseFloat(p)
  if (Number.isNaN(v)) return null
  if (p.endsWith("rad")) return (v * 180) / Math.PI
  if (p.endsWith("turn")) return v * 360
  return v
}

function hslToRgb(h: number, s: number, l: number) {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60
    ? [c, x, 0]
    : h < 120
    ? [x, c, 0]
    : h < 180
    ? [0, c, x]
    : h < 240
    ? [0, x, c]
    : h < 300
    ? [x, 0, c]
    : [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}
