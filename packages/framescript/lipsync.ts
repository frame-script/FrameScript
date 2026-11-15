/**
 * Mouths that move with what is said.
 *
 * ```tsx
 * <Sequence>
 *   <Clip label="zunda"><Audio src="voice/001.wav" /></Clip>
 *   <Clip label="metan"><Audio src="voice/002.wav" /></Clip>
 *   <Clip label="zunda"><Audio src="voice/003.wav" /></Clip>
 * </Sequence>
 * <LipSync clip="zunda" open="zunda/open.png" closed="zunda/closed.png" />
 * ```
 *
 * A mouth follows the sound of the clips with its label, and of the clips in them: every clip with
 * that label, so that a line of each character can have the character's name. How loud they are is
 * read from their files (`audioLevels`), once, and it is the time in the file that counts, so
 * trimming and the rate are followed; the volume isn't, except that what is silenced says nothing.
 *
 * 口パク：指定したラベルのクリップ（とその中のクリップ）の音が鳴っている間、口を開く。
 */

import { type AudioLevels, audioLevels, heardAt, placedSounds, type Sound } from "./audio.ts"
import { type ClipScope, project, useClip, useGlobalCurrentFrame } from "./frame.ts"
import { createElement, type JSXNode } from "./jsx.ts"
import { type Accessor, createMemo, createSignal } from "./reactive.ts"
import type { StyleProp } from "./style.ts"
import { afterMount, isWithin } from "./timeline.ts"
import * as log from "./internal/log.ts"

/** How loud a voice is to open the mouth, against the loudest it is, without a `threshold`. */
const THRESHOLD = 0.1

interface Voice {
  sound: Sound
  levels: AudioLevels
}

/**
 * How loud the sound of the clips labeled `clip` is at the current frame, from 0 to 1, each
 * against the loudest it is anywhere in its file. Without `clip`, the sound of the clip the caller
 * is in, or of everything outside any.
 *
 * 指定したラベルのクリップの音量（各ファイルの最大を 1 とする）を返す関数。
 */
export function useVoiceLevel(clip?: string): Accessor<number> {
  const here = useClip()
  const global = useGlobalCurrentFrame()
  const [voices, setVoices] = createSignal<Voice[]>([])
  // The clips with the label may come after the caller.
  afterMount(() => {
    const test: ((c: ClipScope) => boolean) | null = clip !== undefined
      ? (c) => c.label === clip
      : here
      ? (c) => c === here
      : null
    const found = placedSounds().filter((s) =>
      test === null ? s.clip === null : s.clip !== null && isWithin(s.clip, test)
    )
    if (clip !== undefined && found.length === 0) {
      log.warn(`there is no sound in a clip labeled "${clip}" for a mouth to follow`)
    }
    setVoices(found.map((sound) => ({ sound, levels: audioLevels(sound.src) })))
  })
  return createMemo(() => {
    const frame = global()
    let loudest = 0
    for (const { sound, levels } of voices()) {
      const t = heardAt(sound, frame)
      if (Number.isNaN(t) || !(levels.peak > 0)) continue
      // All of what is heard over the frame.
      const level = levels.max(t, t + sound.span.rate / project.fps) / levels.peak
      if (level > loudest) loudest = level
    }
    return loudest
  })
}

export interface LipSyncProps {
  /** The label of the clips whose sound it follows. Without it, the clip it is in. */
  clip?: string
  /** The picture with the mouth open. */
  open: string
  /** The picture with the mouth closed. */
  closed: string
  /** How loud the voice has to be, against the loudest it is, to open the mouth: 0.1 without it. */
  threshold?: number
  style?: StyleProp
  ref?: (node: number) => void
}

/**
 * A picture that shows `open` while the sound of `clip` is louder than `threshold`, and `closed`
 * otherwise.
 */
export function LipSync(props: LipSyncProps): JSXNode {
  const level = useVoiceLevel(props.clip)
  const open = createMemo(() => level() > (props.threshold ?? THRESHOLD))
  return createElement("img", {
    src: () => (open() ? props.open : props.closed),
    style: props.style,
    ref: props.ref,
  })
}
