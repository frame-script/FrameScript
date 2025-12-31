import { useSyncExternalStore } from "react"

/**
 * Audio source reference used for timeline audio segments.
 *
 * タイムラインの音声セグメントで使う参照情報。
 *
 * @example
 * ```ts
 * const src: AudioSourceRef = { kind: "video", path: "assets/demo.mp4" }
 * ```
 */
export type AudioSourceRef =
  | { kind: "video"; path: string }
  | { kind: "sound"; path: string } // reserved for future <Sound />

/**
 * Audio segment mapped onto the project timeline.
 *
 * プロジェクトタイムライン上の音声セグメント。
 *
 * @example
 * ```ts
 * const seg: AudioSegment = {
 *   id: "music",
 *   source: { kind: "sound", path: "assets/music.mp3" },
 *   projectStartFrame: 0,
 *   sourceStartFrame: 0,
 *   durationFrames: 300,
 * }
 * ```
 */
export type AudioSegment = {
  id: string
  source: AudioSourceRef
  projectStartFrame: number
  sourceStartFrame: number
  durationFrames: number
  fadeInFrames?: number
  fadeOutFrames?: number
  volume?: number
}

type Listener = () => void

let globalSegments: AudioSegment[] = []
const globalListeners = new Set<Listener>()

const subscribeGlobal = (listener: Listener) => {
  globalListeners.add(listener)
  return () => globalListeners.delete(listener)
}

const notifyGlobal = () => {
  globalListeners.forEach((listener) => listener())
}

const getGlobalSegments = () => globalSegments

/**
 * Registers an audio segment in the global audio plan store.
 *
 * グローバル音声プランにセグメントを登録します。
 *
 * @example
 * ```ts
 * registerAudioSegmentGlobal(seg)
 * ```
 */
export const registerAudioSegmentGlobal = (segment: AudioSegment) => {
  const existing = globalSegments.find((item) => item.id === segment.id)
  if (
    existing &&
    existing.source.kind === segment.source.kind &&
    ("path" in existing.source ? existing.source.path : "") ===
      ("path" in segment.source ? segment.source.path : "") &&
    existing.projectStartFrame === segment.projectStartFrame &&
    existing.sourceStartFrame === segment.sourceStartFrame &&
    existing.durationFrames === segment.durationFrames &&
    (existing.fadeInFrames ?? 0) === (segment.fadeInFrames ?? 0) &&
    (existing.fadeOutFrames ?? 0) === (segment.fadeOutFrames ?? 0) &&
    (existing.volume ?? 1) === (segment.volume ?? 1)
  ) {
    return
  }

  globalSegments = [
    ...globalSegments.filter((item) => item.id !== segment.id),
    segment,
  ]
  notifyGlobal()
}

/**
 * Unregisters an audio segment by id.
 *
 * ID 指定で音声セグメントを削除します。
 *
 * @example
 * ```ts
 * unregisterAudioSegmentGlobal("music")
 * ```
 */
export const unregisterAudioSegmentGlobal = (id: string) => {
  const next = globalSegments.filter((segment) => segment.id !== id)
  if (next.length === globalSegments.length) return
  globalSegments = next
  notifyGlobal()
}

/**
 * Returns the current list of audio segments.
 *
 * 現在の音声セグメント一覧を返します。
 *
 * @example
 * ```ts
 * const segments = useAudioSegments()
 * ```
 */
export const useAudioSegments = () => {
  return useSyncExternalStore(subscribeGlobal, getGlobalSegments)
}
