/**
 * What the engine calls: `mount` once from the entry module it makes, then `__fs_info` for the
 * timeline and `__fs_audio` for the sound, once, and `__fs_seek` for every frame.
 */

// First, so that whatever runs after it can print.
import "./internal/console.ts"
import * as cmd from "./internal/commands.ts"
import * as ops from "./internal/ops.ts"
import { audioClips } from "./audio.ts"
import { createElement, Host, type JSXNode } from "./jsx.ts"
import { project, type ProjectSettings, setGlobalFrame } from "./frame.ts"
import { batch, createRoot } from "./reactive.ts"
import { bindStyle, loadPropertyTable } from "./style.ts"
import { clipInfos, projectDuration, runChecks } from "./timeline.ts"

loadPropertyTable(ops.props())

let mounted = false

export function mount(module: Record<string, unknown>, settings: ProjectSettings): void {
  if (mounted) throw new Error("a project is mounted once")
  mounted = true
  Object.assign(project, settings)
  const root = module.default
  if (typeof root !== "function") {
    throw new Error(`${settings.entry} has to export the root component as its default export`)
  }
  createRoot(() => {
    bindStyle(cmd.STAGE, { backgroundColor: settings.background, flexDirection: "column" })
    new Host(cmd.STAGE).mount(createElement(root as (props: object) => JSXNode, null))
  })
  runChecks()
  cmd.flush()
}

// deno-lint-ignore no-explicit-any
const g = globalThis as any

g.__fs_seek = (frame: number) => {
  batch(() => setGlobalFrame(frame))
  cmd.flush()
}

g.__fs_info = () => ({
  durationFrames: projectDuration(),
  clips: clipInfos(),
})

g.__fs_audio = () => audioClips()
