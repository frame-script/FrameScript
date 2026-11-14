/**
 * Videos in clips.
 *
 * ```tsx
 * <Clip label="interview">
 *   <Video src="footage/interview.mp4" trimStart={12} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
 * </Clip>
 * ```
 *
 * A video plays from the start of the clip it is in, with its sound, and the clip lasts as long as
 * the video if nothing says otherwise. Which frame shows is a function of the frame of the clip, like
 * everything else: it is decoded on a thread of its own and kept, so seeking is fast both ways.
 *
 * 動画はクリップの先頭から再生される。どのフレームを出すかはクリップのフレームの関数。
 */

import { addSound, placeSpan, type SoundProps } from "./audio.ts"
import { project, useClip, useCurrentFrame, useGlobalCurrentFrame } from "./frame.ts"
import { createElement, type JSXNode } from "./jsx.ts"
import { createMemo } from "./reactive.ts"
import type { StyleProp } from "./style.ts"
import * as ops from "./internal/ops.ts"

export type { VideoInfo } from "./internal/ops.ts"

const infos = new Map<string, ops.VideoInfo>()

/** What the video in `src` is: how long, how big. Opening it starts decoding it. */
export function videoInfo(src: string): ops.VideoInfo {
  let info = infos.get(src)
  if (!info) {
    info = ops.videoInfo(src)
    infos.set(src, info)
  }
  return info
}

export interface VideoProps extends SoundProps {
  /** Without its sound. */
  muted?: boolean
  style?: StyleProp
  ref?: (node: number) => void
}

/** How long before its clip a video starts decoding, in seconds. */
const PRELOAD = 1

const OFF = 0
const SOON = 1
const SHOWN = 2

/**
 * A video that plays from the start of the clip it is in, with its sound unless `muted`. The clip
 * lasts as long as the video (from `trimStart` to `trimEnd`, at `playbackRate`) unless it is given
 * a duration; its last frame stays after that.
 */
export function Video(props: VideoProps): JSXNode {
  const info = videoInfo(props.src)
  const clip = useClip()
  const frame = useCurrentFrame()
  const global = useGlobalCurrentFrame()
  const { from, to, rate } = placeSpan(props, clip, info.duration)
  if (info.hasAudio && !props.muted) addSound(props.src, { from, to, rate }, clip, props)

  // Changes only when the clip comes into view, shows, and goes.
  const state = createMemo(() => {
    if (!clip) return SHOWN
    const f = global() - clip.start()
    if (f >= 0 && f < clip.duration()) return SHOWN
    if (f < 0 && f >= -PRELOAD * project.fps) return SOON
    return OFF
  })
  const time = createMemo(() => {
    const s = state()
    if (s === OFF) return Number.NaN
    const f = s === SOON ? 0 : frame()
    return Math.min(from + (f / project.fps) * rate, to)
  })

  return createElement("video", {
    src: props.src,
    time,
    shown: () => state() === SHOWN,
    style: props.style,
    ref: props.ref,
  })
}
