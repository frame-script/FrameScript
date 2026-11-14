/**
 * FrameScript2: videos written in TSX.
 *
 * ```tsx
 * import { Clip, seconds, useAnimation, useVariable } from "framescript"
 * ```
 */

export {
  type Accessor,
  batch,
  type Context,
  createContext,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
  type Setter,
  untrack,
  useContext,
} from "./reactive.ts"
export {
  type Component,
  createElement,
  type Element,
  For,
  Fragment,
  type ImageProps,
  type JSXNode,
  provide,
  Show,
  type VideoElementProps,
} from "./jsx.ts"
export type { CSSProperties, Gradient, GradientStop, Paint, StyleProp, StyleProps } from "./style.ts"
export { linearGradient, radialGradient } from "./svg.ts"
export {
  type ClipScope,
  framesToSeconds,
  project,
  type ProjectSettings,
  seconds,
  useClip,
  useCurrentFrame,
  useGlobalCurrentFrame,
} from "./frame.ts"
export { Clip, type ClipProps, Sequence, Timeline } from "./timeline.ts"
export {
  type AnimationContext,
  AnimationHandle,
  type MoveController,
  useAnimation,
  useVariable,
  type Variable,
  type VariableType,
  type Vec2,
  type Vec3,
} from "./animation.ts"
export * from "./easing.ts"
export { type ColorHex, mixColor, parseColor } from "./color.ts"
export { FillFrame } from "./layout.ts"
export { Video, type VideoInfo, videoInfo, type VideoProps, type VideoTexture } from "./media.ts"
export {
  compileShader,
  Shader,
  type ShaderProps,
  type Textures,
  type Uniforms,
  type UniformValue,
} from "./shader.ts"
export {
  Audio,
  type AudioInfo,
  audioInfo,
  type AudioProps,
  type SoundProps,
  type Volume,
} from "./audio.ts"
