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
