// Where things happen, in frames of the project: the same bars as music.py (120 BPM, a bar of 2 s).
import { project, useGlobalCurrentFrame } from "framescript"

export const BEAT = 30
export const BAR = BEAT * 4

/** Where each scene starts, and the end. */
export const AT = {
  intro: 0,
  city: BAR * 3,
  studio: BAR * 7,
  run: BAR * 11,
  code: BAR * 14,
  outro: BAR * 17,
  end: BAR * 20,
}

/** The bars with a kick on each beat, and the one at the start of the outro. */
const KICKS_FROM = AT.city
const KICKS_TO = AT.code

/** Seconds since the last kick at global `frame`; large when there was none lately. */
export function sinceKick(frame: number): number {
  if (frame >= AT.outro) return (frame - AT.outro) / project.fps
  if (frame < KICKS_FROM) return 99
  const last = Math.min(frame, KICKS_TO - 1) - KICKS_FROM
  return (frame - KICKS_FROM - Math.floor(last / BEAT) * BEAT) / project.fps
}

/** The time since the last kick, as a function of the frame being shown. */
export function useKick(): () => number {
  const frame = useGlobalCurrentFrame()
  return () => sinceKick(frame())
}

/** 1 on a kick, down to 0 in about a fifth of a second. */
export function useThump(): () => number {
  const kick = useKick()
  return () => Math.exp(-kick() / 0.09)
}
