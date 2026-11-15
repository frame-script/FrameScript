/**
 * Sound in clips.
 *
 * ```tsx
 * <Clip label="intro">
 *   <Audio src="music/theme.mp3" trimStart={4} volume={0.8} fadeOut={2} />
 *   <Title />
 * </Clip>
 * ```
 *
 * Sound plays from the start of the clip it is in, like a video, and the clip lasts as long as
 * the sound if nothing says otherwise. A `<Video>` plays its own sound too, unless it is `muted`.
 *
 * Sound isn't made frame by frame: when the project loads, where each piece of sound is (and how
 * loud, at every frame) is worked out once, and the engine mixes it from that.
 *
 * 音はクリップの先頭から鳴る。音量を関数にすると、クリップのフレームごとの値として読み込み時に一度だけ計算される。
 */

import { type ClipScope, project, useClip } from "./frame.ts"
import type { JSXNode } from "./jsx.ts"
import { onCleanup } from "./reactive.ts"
import { needAtRoot, projectDuration } from "./timeline.ts"
import * as ops from "./internal/ops.ts"

export type { AudioInfo } from "./internal/ops.ts"

const infos = new Map<string, ops.AudioInfo>()

/** What the sound in `src` is. Opening it starts decoding it. */
export function audioInfo(src: string): ops.AudioInfo {
  let info = infos.get(src)
  if (!info) {
    info = ops.audioInfo(src)
    infos.set(src, info)
  }
  return info
}

/** How loud the sound of a file is over time, for mouths and anything else that moves with it. */
export interface AudioLevels {
  /** How many levels there are for a second of the file. */
  perSecond: number
  /** The root mean square of each 1/`perSecond` of a second, from the start of the file. */
  values: Float32Array
  /** The loudest of them. */
  peak: number
  /** How loud it is at `seconds` into the file; 0 outside it. */
  at(seconds: number): number
  /** The loudest from `from` to `to` seconds into the file. */
  max(from: number, to: number): number
}

const levels = new Map<string, AudioLevels>()

/**
 * How loud the sound in `src` is over time. The file is read through once, the first time, which
 * for a voice takes a few milliseconds.
 *
 * 音量の推移（RMS、1/100 秒ごと）。最初の一回だけファイルを読み通す。
 */
export function audioLevels(src: string): AudioLevels {
  let l = levels.get(src)
  if (!l) {
    const values = new Float32Array(ops.audioLevels(src))
    const perSecond = ops.LEVELS_PER_SECOND
    let peak = 0
    for (const v of values) if (v > peak) peak = v
    const max = (from: number, to: number) => {
      if (to < 0) return 0
      const first = Math.max(0, Math.floor(from * perSecond))
      const end = Math.min(values.length, Math.max(first + 1, Math.ceil(to * perSecond)))
      let m = 0
      for (let i = first; i < end; i++) if (values[i] > m) m = values[i]
      return m
    }
    l = { perSecond, values, peak, at: (seconds) => max(seconds, seconds), max }
    levels.set(src, l)
  }
  return l
}

/**
 * How loud: 1 is as it is in the file, 0 is silent. A function is given the frame of the clip and
 * is called for every frame once, when the project loads: it can't follow signals.
 */
export type Volume = number | ((frame: number) => number)

/** What sound and video have in common. */
export interface SoundProps {
  /** A file of the project, or an absolute path. */
  src: string
  /** Seconds into the file at the start of the clip. */
  trimStart?: number
  /** Seconds into the file where it ends. The end of the file without it. */
  trimEnd?: number
  /** How fast it goes: 2 is twice as fast, and an octave up. */
  playbackRate?: number
  volume?: Volume
  /** Seconds it takes to come up from silence at the start. */
  fadeIn?: number
  /** Seconds it takes to go down to silence at the end. */
  fadeOut?: number
}

export interface AudioProps extends SoundProps {
  muted?: boolean
}

/** How it is placed on the timeline: from where, to where, how fast. */
export interface Span {
  from: number
  to: number
  rate: number
}

/**
 * @internal Checks what is to play when, and makes the clip it is in last as long as that unless
 * it is given a duration.
 */
export function placeSpan(props: SoundProps, clip: ClipScope | null, duration: number | null): Span {
  const rate = props.playbackRate ?? 1
  const from = props.trimStart ?? 0
  const to = props.trimEnd ?? duration ?? Infinity
  if (!(rate > 0)) throw new RangeError(`playbackRate has to be more than 0, not ${rate}`)
  const length = Math.max(0, Math.ceil(((to - from) / rate) * project.fps - 1e-6))
  if (Number.isFinite(length)) {
    if (clip) clip.need(() => length)
    else needAtRoot(() => length)
  }
  return { from, to, rate }
}

/** @internal A piece of sound and where it is. */
export interface Sound {
  src: string
  span: Span
  clip: ClipScope | null
  volume: Volume
  fadeIn: number
  fadeOut: number
}

const sounds = new Set<Sound>()

/** @internal Plays `src` over `span` from the start of `clip`, for as long as the caller is there. */
export function addSound(src: string, span: Span, clip: ClipScope | null, props: SoundProps): void {
  const sound: Sound = {
    src,
    span,
    clip,
    volume: props.volume ?? 1,
    fadeIn: Math.max(0, props.fadeIn ?? 0),
    fadeOut: Math.max(0, props.fadeOut ?? 0),
  }
  sounds.add(sound)
  onCleanup(() => sounds.delete(sound))
}

/** @internal Every piece of sound there is. */
export function placedSounds(): Sound[] {
  return [...sounds]
}

/**
 * @internal How many seconds into its file `sound` is at the frame `global` of the project, or NaN
 * when it isn't heard then: outside its clip, after its end, or with no volume.
 */
export function heardAt(sound: Sound, global: number): number {
  const start = sound.clip ? sound.clip.start() : 0
  const f = global - start
  if (f < 0 || (sound.clip && f >= sound.clip.duration())) return Number.NaN
  const volume = typeof sound.volume === "function" ? sound.volume(f) : sound.volume
  if (!(volume > 0)) return Number.NaN
  const t = sound.span.from + (f / project.fps) * sound.span.rate
  return t < sound.span.to ? t : Number.NaN
}

/** Sound that plays from the start of the clip it is in. It shows nothing. */
export function Audio(props: AudioProps): JSXNode {
  const info = audioInfo(props.src)
  const clip = useClip()
  const span = placeSpan(props, clip, info.duration)
  if (!props.muted) addSound(props.src, span, clip, props)
  return null
}

/** What `crates/framescript-engine/src/sound.rs` takes as an `AudioClip`. */
interface AudioClip {
  src: string
  start: number
  end: number
  from: number
  rate: number
  volume: number
  envelope: number[] | null
  fadeIn: number
  fadeOut: number
}

/** @internal Where every piece of sound is, in seconds, for the engine. */
export function audioClips(): AudioClip[] {
  const fps = project.fps
  const total = projectDuration()
  const out: AudioClip[] = []
  for (const s of sounds) {
    const first = s.clip ? s.clip.start() : 0
    const d = s.clip ? s.clip.duration() : Infinity
    const last = Number.isFinite(d) ? first + d : total
    const start = first / fps
    const end = Math.min(last / fps, start + (s.span.to - s.span.from) / s.span.rate)
    if (!(end > start)) continue
    let volume = 1
    let envelope: number[] | null = null
    if (typeof s.volume === "function") {
      const f = s.volume
      envelope = Array.from({ length: Math.ceil((end - start) * fps) + 1 }, (_, i) => Math.max(0, f(i)))
    } else {
      volume = Math.max(0, s.volume)
    }
    out.push({
      src: s.src,
      start,
      end,
      from: s.span.from,
      rate: s.span.rate,
      volume,
      envelope,
      fadeIn: s.fadeIn,
      fadeOut: s.fadeOut,
    })
  }
  return out
}
