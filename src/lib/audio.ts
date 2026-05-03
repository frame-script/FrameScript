import { PROJECT_SETTINGS } from "../../project/project"

/**
 * Audio source path.
 *
 * 音声ソースのパス。
 *
 * @example
 * ```ts
 * const src: AudioSource = "assets/music.mp3"
 * ```
 */
export type AudioSource = { path: string } | string

const audioCache = new Map<string, Promise<AudioBuffer>>()

const normalize = (src: AudioSource): { path: string } =>
  typeof src === "string" ? { path: src } : src

const buildAudioUrl = (src: { path: string }) => {
  const url = new URL("http://localhost:3000/audio")
  url.searchParams.set("path", src.path)
  return url.toString()
}

/**
 * Fetches and decodes an audio file into an AudioBuffer (cached).
 *
 * 音声ファイルを取得して AudioBuffer にデコードします（キャッシュ付き）。
 *
 * @example
 * ```ts
 * const buffer = await fetchAudioBuffer("assets/music.mp3", audioCtx)
 * ```
 */
export const fetchAudioBuffer = async (
  src: AudioSource,
  audioContext: AudioContext,
): Promise<AudioBuffer> => {
  const resolved = normalize(src)
  const cached = audioCache.get(resolved.path)
  if (cached) return cached

  const promise = (async () => {
    const res = await fetch(buildAudioUrl(resolved), {
      headers: {
        Range: "bytes=0-",
      },
    })
    if (!res.ok) {
      throw new Error(`failed to fetch audio: ${res.status}`)
    }
    const buffer = await res.arrayBuffer()
    return audioContext.decodeAudioData(buffer)
  })()

  audioCache.set(resolved.path, promise)
  return promise
}

// helper: convert frames (project fps) to seconds for audio alignment
/**
 * Converts frames to seconds using project FPS.
 *
 * プロジェクト FPS に基づいてフレーム数を秒へ変換します。
 *
 * @example
 * ```ts
 * const sec = framesToSeconds(120)
 * ```
 */
export const framesToSeconds = (frames: number) => frames / PROJECT_SETTINGS.fps
