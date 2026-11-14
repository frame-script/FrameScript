/**
 * What a `<Scene3D>` tells what is in it. Here rather than in `3d.ts`, so that `<Clip>` can know
 * it is in a scene without the timeline depending on 3D.
 */

import type { JSXNode } from "../jsx.ts"
import { type Accessor, createContext } from "../reactive.ts"

export interface Space {
  /** A group of things in 3D, shown while `visible` is true: what a `<Clip>` is in a scene. */
  group(visible: Accessor<boolean>, children: JSXNode): JSXNode
  /** Something in the scene changes with the time (its WGSL reads `fs.time`). */
  needTime(): void
}

export const SpaceContext = createContext<Space | null>(null, "space")
