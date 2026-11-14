/**
 * WGSL: a box that a shader draws, and what is given to shaders (uniforms and textures).
 *
 * ```tsx
 * import plasma from "./plasma.wgsl"
 *
 * <Shader wgsl={plasma} uniforms={{ color: "#38bdf8", speed: 0.5 }} style={{ width: "100%", height: "100%" }} />
 * ```
 *
 * The WGSL declares `fn shade(uv: vec2f) -> vec4f`, which gives the color (as light, with straight
 * alpha) at `uv`, from (0, 0) at the top left to (1, 1) at the bottom right; or a `@fragment` of its
 * own. FrameScript adds `fs`, with `fs.time` (seconds into the clip), `fs.frame` and
 * `fs.resolution` (the size of the box in its pixels). What it is given goes in `@group(1)`: one
 * uniform buffer, whose members are given by name in `uniforms`, and `texture_2d<f32>`s, given by
 * name in `textures`, with any `sampler`s. Colors given as uniforms are turned into light (linear).
 *
 * WGSL の `shade(uv)` が色（光、ストレートアルファ）を返す。`@group(1)` の uniform は名前で渡す。
 */

import { parseColor } from "./color.ts"
import { project, useCurrentFrame } from "./frame.ts"
import { Host, type JSXNode, nodeChild } from "./jsx.ts"
import { type Accessor, createRenderEffect, onCleanup, untrack } from "./reactive.ts"
import { bindStyle, type StyleProp } from "./style.ts"
import { isVideoTexture, type VideoTexture, videoTextureNode } from "./media.ts"
import * as cmd from "./internal/commands.ts"
import * as ops from "./internal/ops.ts"

type MaybeAccessor<T> = T | Accessor<T>

/**
 * What a uniform can be given as: numbers (one, or a list for vectors, matrices and arrays, column
 * after column), `{ x, y, z, w }`, a CSS color (for a `vec3f` or a `vec4f`), or a boolean (1 or 0).
 */
export type UniformValue =
  | number
  | boolean
  | string
  | { x: number; y: number; z?: number; w?: number }
  | readonly (number | readonly number[])[]

export type Uniforms = Record<string, MaybeAccessor<UniformValue>>
/**
 * What the textures of a shader show, by their names: pictures (files of the project), or videos
 * (`{ video: "assets/clip.mp4", trimStart: 2 }`, placed and heard as a `<Video>` where it is).
 */
export type Textures = Record<string, MaybeAccessor<string> | VideoTexture>

export interface ShaderProps {
  /** The code: a string, or what a `.wgsl` file imports as. */
  wgsl: string
  uniforms?: Uniforms
  textures?: Textures
  style?: StyleProp
  /** What is laid over it. */
  children?: JSXNode
  ref?: (node: number) => void
}

/** The stages of `op_fs_shader`. */
export const STAGE_FLAT = 0
export const STAGE_MATERIAL = 1
export const STAGE_EFFECT = 2

/** Compiles `wgsl` (once), throwing what is wrong with it at the line of its file. */
export function compileShader(wgsl: string, stage: number): ops.ShaderInfo {
  // deno-lint-ignore no-explicit-any
  const paths = (globalThis as any).__fs_wgsl as Map<string, string> | undefined
  return ops.shader(wgsl, paths?.get(wgsl) ?? "WGSL", stage)
}

/**
 * A box that a shader draws all of. Like `<canvas>`, it is 300 by 150 when nothing says how big.
 * It is drawn again when what it is given changes, and every frame if it reads `fs.time`.
 */
export function Shader(props: ShaderProps): JSXNode {
  const info = compileShader(props.wgsl, STAGE_FLAT)
  const frame = useCurrentFrame()
  return nodeChild(() => {
    const node = cmd.createNode(cmd.KIND_SHADER)
    onCleanup(() => cmd.removeNode(node))
    if (props.style) bindStyle(node, props.style)
    cmd.setParam(node, cmd.P.SHADER, [info.id])
    bindUniforms(node, info, props.uniforms)
    bindTextures(node, info, props.textures)
    if (info.usesTime) bindTime(node, frame)
    new Host(node).mount(props.children)
    props.ref?.(node)
    return node
  })
}

/** Sends the time of the clip to `node` whenever its frame changes. */
export function bindTime(node: number, frame: Accessor<number>): void {
  createRenderEffect(() => {
    const f = frame()
    untrack(() => cmd.setParam(node, cmd.P.TIME, [f / project.fps, f]))
  })
}

/**
 * Gives the uniforms of `info` their values, and again whenever those that are functions change:
 * with `param`, after `prefix` (what the shader is to the node, if it has several).
 */
export function bindUniforms(
  node: number,
  info: ops.ShaderInfo,
  uniforms: Uniforms | undefined,
  param: number = cmd.P.UNIFORM,
  prefix: number[] = [],
): void {
  if (!uniforms) return
  for (const [name, value] of Object.entries(uniforms)) {
    const index = info.uniforms.findIndex(([n]) => n === name)
    if (index < 0) {
      const names = info.uniforms.map(([n]) => n)
      throw new Error(`uniforms.${name} is not in the WGSL${suggest(name, names)}`)
    }
    const [, type, size] = info.uniforms[index]
    const send = (v: UniformValue) => cmd.setParam(node, param, [...prefix, index, ...numbers(name, v, type, size)])
    if (typeof value === "function") {
      createRenderEffect(() => {
        const v = value()
        untrack(() => send(v))
      })
    } else {
      send(value)
    }
  }
}

/**
 * Gives the textures of `info` their pictures or videos: `at` is what the texture of an index is
 * to the node, and `text` and `video` the parameters they are given with.
 */
export function bindTextures(
  node: number,
  info: ops.ShaderInfo,
  textures: Textures | undefined,
  at: (index: number) => number = (i) => i,
  text: number = cmd.TEXT_TEXTURE,
  video: number = cmd.P.VIDEO_TEXTURE,
): void {
  if (!textures) return
  for (const [name, src] of Object.entries(textures)) {
    const index = info.textures.indexOf(name)
    if (index < 0) {
      throw new Error(`textures.${name} is not a texture of the WGSL${suggest(name, info.textures)}`)
    }
    if (isVideoTexture(src)) {
      cmd.setParam(node, video, [at(index), videoTextureNode(src)])
    } else if (typeof src === "function") {
      createRenderEffect(() => {
        const s = src()
        untrack(() => cmd.setParamText(node, text, at(index), s))
      })
    } else {
      cmd.setParamText(node, text, at(index), src)
    }
  }
}

/** A CSS color as light: linear red, green, blue, and alpha. */
export function linearColor(value: string): [number, number, number, number] {
  const packed = parseColor(value)
  if (packed === null) throw new Error(`${value} is not a color`)
  const c = (shift: number) => toLinear(((packed >>> shift) & 0xff) / 255)
  return [c(24), c(16), c(8), (packed & 0xff) / 255]
}

function toLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function numbers(name: string, value: UniformValue, type: string, size: number): number[] {
  let out: number[]
  if (typeof value === "number") out = [value]
  else if (typeof value === "boolean") out = [value ? 1 : 0]
  else if (typeof value === "string") {
    const rgba = linearColor(value)
    out = size === 3 ? rgba.slice(0, 3) : rgba
  } else if (Array.isArray(value)) out = (value as readonly (number | readonly number[])[]).flat()
  else {
    const v = value as { x: number; y: number; z?: number; w?: number }
    out = [v.x, v.y]
    if (v.z !== undefined) out.push(v.z)
    if (v.w !== undefined) out.push(v.w)
  }
  if (out.length !== size) {
    throw new Error(
      `uniforms.${name} is a ${type}, which takes ${size} number${size === 1 ? "" : "s"}, ` +
        `but ${JSON.stringify(value)} is ${out.length}`,
    )
  }
  return out
}

/** ` (did you mean …?)` for the name in `names` closest to `name`, if one is close. */
function suggest(name: string, names: string[]): string {
  let best: string | null = null
  let bestDistance = Infinity
  for (const n of names) {
    const d = distance(name, n)
    if (d < bestDistance) [best, bestDistance] = [n, d]
  }
  if (best !== null && bestDistance <= Math.max(2, name.length / 3)) return ` (did you mean ${best}?)`
  return names.length ? ` (it has ${names.join(", ")})` : " (it has none)"
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const here = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = here
    }
  }
  return row[b.length]
}
