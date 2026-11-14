// When things happen, in frames of the project: the same bars as music.py (120 BPM, a bar of 2 s).
import { useGlobalCurrentFrame } from "framescript"

export const BEAT = 30
export const BAR = BEAT * 4

/** Where each scene starts, and the end. */
export const AT = {
  point: 0,
  title: BAR * 3,
  morph: BAR * 6,
  data: BAR * 10,
  pattern: BAR * 14,
  finale: BAR * 18,
  end: BAR * 22,
}

/** The bars with a kick on every beat (the breakdown and the build have none). */
const KICKS: [number, number][] = [
  [AT.title, AT.pattern],
  [AT.finale, AT.end - BAR],
]

/** Frames since the last kick at global `frame`; large when there was none lately. */
export function sinceKick(frame: number): number {
  for (const [from, to] of KICKS) {
    if (frame >= from && frame < to + BEAT) {
      const last = Math.min(frame, to - 1) - from
      return frame - from - Math.floor(last / BEAT) * BEAT
    }
  }
  return 999
}

/** 1 on a kick, down to 0 in about a fifth of a second. */
export function useThump(): () => number {
  const frame = useGlobalCurrentFrame()
  return () => Math.exp(-sinceKick(frame()) / 6)
}
