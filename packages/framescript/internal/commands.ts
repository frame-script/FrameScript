/**
 * The command buffer (see `crates/framescript-engine/src/commands.rs` for the format).
 *
 * Effects append to it while a frame is being made; `flush` hands it to Rust in one fast call,
 * with no JSON in between. Numbers are written through a `Float32Array` over the same memory as
 * the `Uint32Array` that is sent.
 */

import * as ops from "./ops.ts"

export const KIND_ELEMENT = 0
export const KIND_TEXT = 1
export const KIND_IMAGE = 2
export const KIND_VIDEO = 3
export const KIND_SHADER = 4
export const KIND_SCENE = 5
export const KIND_GROUP = 6
export const KIND_MESH = 7
export const KIND_CAMERA = 8
export const KIND_LIGHT = 9

/** The node the composition makes for the frame itself. */
export const STAGE = 0

const NUMBER = 1
const LENGTH = 2
const COLOR = 3
const ENUM = 4
const UNSET = 5
const SHADOWS = 6
const CHILDREN = 7
const REMOVE = 8
const STRING = 9
const TEXT = 10
const SOURCE = 11
const VIDEO_TIME = 12
const PARAM = 13
const PARAM_TEXT = 14

/** The parameters of `<Shader>` boxes, scenes and things in 3D (`crate::space::param` in Rust). */
export const P = {
  POSITION: 0,
  ROTATION: 1,
  QUATERNION: 2,
  SCALE: 3,
  LOOK_AT: 4,
  VISIBLE: 5,
  GEOMETRY: 10,
  COLOR: 11,
  METALNESS: 12,
  ROUGHNESS: 13,
  EMISSIVE: 14,
  OPACITY: 15,
  DOUBLE_SIDED: 16,
  TRANSPARENT: 17,
  SHADER: 18,
  UNIFORM: 19,
  FOV: 30,
  NEAR: 31,
  FAR: 32,
  ORTHOGRAPHIC: 33,
  ACTIVE: 34,
  LIGHT: 40,
  LIGHT_COLOR: 41,
  INTENSITY: 42,
  RANGE: 43,
  ANGLE: 44,
  PENUMBRA: 45,
  GROUND_COLOR: 46,
  BACKGROUND: 50,
  TONE_MAPPING: 51,
  EXPOSURE: 52,
  TIME: 53,
} as const

/** The parameters given as a file (`crate::space::text_param`). */
export const TEXT_MAP = 0
export const TEXT_TEXTURE = 1

export const UNIT_PX = 0
export const UNIT_PERCENT = 1
export const UNIT_AUTO = 2
export const UNIT_NUMBER = 3

let words = new Uint32Array(1 << 14)
let floats = new Float32Array(words.buffer)
let len = 0

function reserve(n: number) {
  if (len + n <= words.length) return
  flush()
  if (n > words.length) {
    let size = words.length
    while (size < n) size *= 2
    words = new Uint32Array(size)
    floats = new Float32Array(words.buffer)
  }
}

export function flush(): void {
  if (len === 0) return
  ops.commit(words.subarray(0, len))
  len = 0
}

export function createNode(kind: number): number {
  return ops.create(kind)
}

export function setNumber(node: number, prop: number, value: number): void {
  reserve(4)
  words[len] = NUMBER
  words[len + 1] = node
  words[len + 2] = prop
  floats[len + 3] = value
  len += 4
}

export function setLength(node: number, prop: number, unit: number, value: number): void {
  reserve(5)
  words[len] = LENGTH
  words[len + 1] = node
  words[len + 2] = prop
  words[len + 3] = unit
  floats[len + 4] = value
  len += 5
}

export function setColor(node: number, prop: number, rgba: number): void {
  reserve(4)
  words[len] = COLOR
  words[len + 1] = node
  words[len + 2] = prop
  words[len + 3] = rgba >>> 0
  len += 4
}

export function setEnum(node: number, prop: number, index: number): void {
  reserve(4)
  words[len] = ENUM
  words[len + 1] = node
  words[len + 2] = prop
  words[len + 3] = index
  len += 4
}

export function unset(node: number, prop: number): void {
  reserve(3)
  words[len] = UNSET
  words[len + 1] = node
  words[len + 2] = prop
  len += 3
}

export interface Shadow {
  x: number
  y: number
  blur: number
  spread: number
  /** `0xRRGGBBAA`. */
  color: number
  inset: boolean
}

export function setShadows(node: number, prop: number, shadows: Shadow[]): void {
  reserve(4 + shadows.length * 6)
  words[len] = SHADOWS
  words[len + 1] = node
  words[len + 2] = prop
  words[len + 3] = shadows.length
  len += 4
  for (const s of shadows) {
    floats[len] = s.x
    floats[len + 1] = s.y
    floats[len + 2] = s.blur
    floats[len + 3] = s.spread
    words[len + 4] = s.color >>> 0
    words[len + 5] = s.inset ? 1 : 0
    len += 6
  }
}

export function setChildren(node: number, children: number[]): void {
  reserve(3 + children.length)
  words[len] = CHILDREN
  words[len + 1] = node
  words[len + 2] = children.length
  len += 3
  for (const c of children) words[len++] = c
}

export function removeNode(node: number): void {
  reserve(2)
  words[len] = REMOVE
  words[len + 1] = node
  len += 2
}

export function setString(node: number, prop: number, value: string): void {
  reserve(4 + ((value.length + 1) >> 1))
  words[len] = STRING
  words[len + 1] = node
  words[len + 2] = prop
  len += 3
  writeString(value)
}

export function setText(node: number, value: string): void {
  reserve(3 + ((value.length + 1) >> 1))
  words[len] = TEXT
  words[len + 1] = node
  len += 2
  writeString(value)
}

/** The file an image or a video shows. */
export function setSource(node: number, src: string): void {
  reserve(3 + ((src.length + 1) >> 1))
  words[len] = SOURCE
  words[len + 1] = node
  len += 2
  writeString(src)
}

const seconds = new Float64Array(1)
const secondsWords = new Uint32Array(seconds.buffer)

/**
 * What a video shows: `time` seconds into it, or nothing for NaN. A video that isn't `shown` yet
 * is about to be, and starts decoding.
 */
export function setVideoTime(node: number, time: number, shown: boolean): void {
  reserve(5)
  seconds[0] = time
  words[len] = VIDEO_TIME
  words[len + 1] = node
  words[len + 2] = shown ? 1 : 0
  // The low half first, which is how a little-endian machine has it.
  words[len + 3] = secondsWords[0]
  words[len + 4] = secondsWords[1]
  len += 5
}

/** Sets a parameter of a `<Shader>`, a scene or a thing in 3D to `values`; none takes it back. */
export function setParam(node: number, param: number, values: ArrayLike<number>): void {
  reserve(4 + values.length)
  words[len] = PARAM
  words[len + 1] = node
  words[len + 2] = param
  words[len + 3] = values.length
  len += 4
  for (let i = 0; i < values.length; i++) floats[len++] = values[i]
}

/** Gives a picture to one: the file `src`, or none for "". */
export function setParamText(node: number, param: number, index: number, src: string): void {
  reserve(5 + ((src.length + 1) >> 1))
  words[len] = PARAM_TEXT
  words[len + 1] = node
  words[len + 2] = param
  words[len + 3] = index
  len += 4
  writeString(src)
}

/** The length in UTF-16 code units, then the units, two to a word, the first in the low half. */
function writeString(value: string) {
  const n = value.length
  words[len++] = n
  for (let i = 0; i < n; i += 2) {
    const low = value.charCodeAt(i)
    const high = i + 1 < n ? value.charCodeAt(i + 1) : 0
    words[len++] = (low | (high << 16)) >>> 0
  }
}
