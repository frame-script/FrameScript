/**
 * The ops of `crates/framescript-engine/src/ext.rs`.
 */

// deno-lint-ignore no-explicit-any
const core = (globalThis as any).Deno.core

/** Makes a node (see `commands::kind` in Rust) and returns its handle. */
export const create: (kind: number) => number = core.ops.op_fs_create

/** Hands the command buffer to Rust. */
export const commit: (words: Uint32Array) => void = core.ops.op_fs_commit

/** Name, kind and choices of every style property, in the order of their numbers. */
export const props: () => [string, number, string[]][] = core.ops.op_fs_props

export interface VideoInfo {
  /** In seconds, or `null` if the file doesn't say. */
  duration: number | null
  width: number
  height: number
  frameRate: number | null
  hasAudio: boolean
}

/** What the video in a file of the project is. Throws if it can't be opened. */
export const videoInfo: (src: string) => VideoInfo = core.ops.op_fs_video_info

export interface AudioInfo {
  /** In seconds, or `null` if the file doesn't say. */
  duration: number | null
}

/** What the sound in a file of the project is. Throws if it has none. */
export const audioInfo: (src: string) => AudioInfo = core.ops.op_fs_audio_info

/** How many levels a second `audioLevels` gives: `sound::LEVELS_PER_SECOND` in Rust. */
export const LEVELS_PER_SECOND = 100

/**
 * How loud the sound in a file of the project is over time, as the bytes of `f32`s: the root mean
 * square of each 1/`LEVELS_PER_SECOND` of a second from its start. Throws if it has none.
 */
export const audioLevels: (src: string) => ArrayBuffer = core.ops.op_fs_audio_levels

export interface ShaderInfo {
  /** The number the commands give it by. */
  id: number
  /** Per uniform, by its number: its name, its type, and how many numbers it takes. */
  uniforms: [string, string, number][]
  /** The names of its textures, by their indices. */
  textures: string[]
  /** Whether it reads `fs.time` or `fs.frame`. */
  usesTime: boolean
}

/**
 * Compiles WGSL (from the file `path`) for a `<Shader>` box (stage 0) or a material (stage 1).
 * Throws what is wrong with it.
 */
export const shader: (code: string, path: string, stage: number) => ShaderInfo = core.ops.op_fs_shader

export interface ModelInfo {
  /** Per animation: its name and how long it is, in seconds. */
  animations: [string, number][]
}

/** What the glTF model in a file of the project has. Throws if it can't be read. */
export const modelInfo: (src: string) => ModelInfo = core.ops.op_fs_model_info

/** Runs every queued microtask now. */
export const runMicrotasks: () => void = () => core.runMicrotasks()
