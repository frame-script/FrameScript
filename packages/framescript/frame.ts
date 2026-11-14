/**
 * The frame being shown, and the project's settings.
 *
 * フレームは数値ではなくアクセサ（関数）で受け取る。読んだ場所だけがフレームに追従する。
 */

import { type Accessor, createContext, createSignal, useContext } from "./reactive.ts"

export interface ProjectSettings {
  name: string
  width: number
  height: number
  fps: number
  entry: string
  background: string
  /** In seconds, if `framescript.json` says. */
  duration?: number | null
}

/** The settings of `framescript.json`. Known before any module of the project is run. */
export const project: ProjectSettings = {
  name: "untitled",
  width: 1920,
  height: 1080,
  fps: 60,
  entry: "main.tsx",
  background: "#000000",
  duration: null,
}

const [globalFrame, setGlobalFrame] = createSignal(0)

/** @internal The host moves the frame with this. */
export { setGlobalFrame }

/** What a clip tells what is inside it. */
export interface ClipScope {
  id: number
  label: string | undefined
  /** The first frame, in the frames of the project. */
  start: Accessor<number>
  /** In frames; `Infinity` until it is known, for a clip that lasts as long as the project. */
  duration: Accessor<number>
  /** The frame relative to the start, held at the ends while the clip isn't shown. */
  frame: Accessor<number>
  depth: number
  /** Animations and inner clips say how long they need. */
  need(frames: Accessor<number>): void
}

export const ClipContext = createContext<ClipScope | null>(null, "clip")

/**
 * The frame being shown, relative to the start of the clip it is in. It is a function: read it
 * where it should be followed (`style={{ opacity: () => frame() / 30 }}`), not once in the body
 * of the component.
 *
 * 現在のフレーム（クリップの先頭からの相対値）を返す関数。
 */
export function useCurrentFrame(): Accessor<number> {
  return useContext(ClipContext)?.frame ?? globalFrame
}

/** The frame being shown, in the frames of the project. */
export function useGlobalCurrentFrame(): Accessor<number> {
  return globalFrame
}

/** The clip the caller is in, if any. */
export function useClip(): ClipScope | null {
  return useContext(ClipContext)
}

/** Frames in `seconds` at the project's rate. */
export function seconds(seconds: number): number {
  return Math.round(seconds * project.fps)
}

/** Seconds in `frames` at the project's rate. */
export function framesToSeconds(frames: number): number {
  return frames / project.fps
}
