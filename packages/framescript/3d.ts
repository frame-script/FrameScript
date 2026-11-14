/**
 * Scenes in 3D.
 *
 * ```tsx
 * import { Box, DirectionalLight, PerspectiveCamera, Scene3D } from "framescript/3d"
 *
 * <Scene3D style={{ width: "100%", height: "100%" }} background="#0f172a">
 *   <PerspectiveCamera position={[0, 1.5, 5]} lookAt={[0, 0, 0]} />
 *   <DirectionalLight position={[3, 5, 2]} intensity={2} />
 *   <Box position={lift} rotation={() => [0, frame() * 2, 0]} material={{ color: "#38bdf8" }} />
 * </Scene3D>
 * ```
 *
 * A `<Scene3D>` is a box, laid out like any other; what is drawn in 3D goes in it, and anything
 * else in it is laid over it. Things are placed in the scene's own space: Y up, X to the right, Z
 * toward the camera that hasn't turned, in units of your choice. Every value is a value, a
 * function or a `Variable`, as in styles, and only what changes is sent. What is drawn depends on
 * the frame alone, so any frame can be drawn first, on any thread.
 *
 * Colors are CSS colors. Rotations are in degrees, about X, then Y, then Z (as three.js). A light
 * of intensity 1 makes a white surface that faces it white.
 *
 * `<Scene3D>` は箱の一つ。中の 3D の物はシーンの空間に置かれ、それ以外は上に重なる。
 */

import { framesToSeconds, useCurrentFrame } from "./frame.ts"
import { existingNode, Host, type JSXNode, nodeChild, provide } from "./jsx.ts"
import { type Accessor, createRenderEffect, createSignal, onCleanup, untrack, useContext } from "./reactive.ts"
import {
  bindTextures,
  bindTime,
  bindUniforms,
  compileShader,
  linearColor,
  STAGE_EFFECT,
  STAGE_MATERIAL,
  type Textures,
  type Uniforms,
} from "./shader.ts"
import { bindStyle, type StyleProp } from "./style.ts"
import type { Vec3 } from "./animation.ts"
import { isVideoTexture, type VideoTexture, videoTextureNode } from "./media.ts"
import * as cmd from "./internal/commands.ts"
import * as ops from "./internal/ops.ts"
import { type Space, SpaceContext } from "./internal/space.ts"

export type { UniformValue, Uniforms, Textures } from "./shader.ts"
export type { VideoTexture } from "./media.ts"

type MaybeAccessor<T> = T | Accessor<T>

/** A point or a direction: `[x, y, z]` or `{ x, y, z }`. */
export type Vec3Like = Vec3 | readonly [number, number, number]

/** Where a thing is, relative to what it is in. */
export interface Object3DProps {
  position?: MaybeAccessor<Vec3Like>
  /** In degrees, about X, then Y, then Z. */
  rotation?: MaybeAccessor<Vec3Like>
  /** `[x, y, z, w]`, in place of `rotation`. */
  quaternion?: MaybeAccessor<readonly [number, number, number, number] | null>
  /** One number for all three. */
  scale?: MaybeAccessor<number | Vec3Like>
  /**
   * A point of the scene to turn to, in place of `rotation`: a camera or a light looks at it, a
   * mesh or a group turns its +Z to it.
   */
  lookAt?: MaybeAccessor<Vec3Like | null>
  visible?: MaybeAccessor<boolean>
  /** Things in 3D. */
  children?: JSXNode
}

/**
 * What a surface is like. `wgsl` gives a material of its own: it can declare `surface`, which
 * returns the `Surface` at a point (start from `default_surface(in)`, which is what the other
 * fields make), `fragment`, which returns the color itself with no light, and `vertex`, which moves
 * the vertices. Its `@group(1)` takes `uniforms` and `textures`, as a `<Shader>`'s.
 */
export interface Material {
  color?: MaybeAccessor<string>
  /** 0 for a dielectric, 1 for a metal. */
  metalness?: MaybeAccessor<number>
  /** 0 is a mirror, 1 is chalk. */
  roughness?: MaybeAccessor<number>
  /** Light that it gives off itself. */
  emissive?: MaybeAccessor<string>
  emissiveIntensity?: MaybeAccessor<number>
  opacity?: MaybeAccessor<number>
  /**
   * A picture the color is multiplied by, or a video (`{ video: "assets/clip.mp4" }`, placed and
   * heard as a `<Video>` where the mesh is).
   */
  map?: MaybeAccessor<string> | VideoTexture
  /** Both of its sides are drawn. */
  doubleSided?: MaybeAccessor<boolean>
  /** Drawn after what is opaque, from the farthest, whatever its opacity. */
  transparent?: MaybeAccessor<boolean>
  wgsl?: string
  uniforms?: Uniforms
  textures?: Textures
}

/** A shape of its own. Normals that aren't given are made from the faces. */
export interface GeometryData {
  /** x, y, z of each vertex. */
  positions: ArrayLike<number>
  normals?: ArrayLike<number>
  /** u, v of each vertex; (0, 0) is the top left of a picture. */
  uvs?: ArrayLike<number>
  /** Three per triangle, counter-clockwise from the side that faces out. Without them, each three vertices are one. */
  indices?: ArrayLike<number>
}

interface ShapeProps extends Object3DProps {
  material?: Material
  /** Whether it casts shadows from lights that cast them. Yes if not given. */
  castShadow?: MaybeAccessor<boolean>
  /** Whether shadows fall on it. Yes if not given. */
  receiveShadow?: MaybeAccessor<boolean>
}

export interface MeshProps extends ShapeProps {
  geometry: MaybeAccessor<GeometryData>
}

// --- The scene ---------------------------------------------------------------------------------

export interface Scene3DProps {
  style?: StyleProp
  /** Transparent if not given: what is behind the box shows. */
  background?: MaybeAccessor<string>
  /** How light is made into colors. `"neutral"` (the default) keeps colors as they are up to bright. */
  toneMapping?: MaybeAccessor<"none" | "neutral" | "aces">
  /** What the light is multiplied by first. */
  exposure?: MaybeAccessor<number>
  /**
   * What is done to all of the scene once it is drawn, in order: `bloom()`, or WGSL of your own
   * (`{ wgsl, uniforms, textures }`), which declares `fn effect(uv: vec2f) -> vec4f` and reads the
   * scene so far with `scene(uv)`; both are light, premultiplied.
   */
  effects?: Effect[]
  /** Things in 3D, and what is laid over the scene. */
  children?: JSXNode
  ref?: (node: number) => void
}

/** What is done to all of a scene once it is drawn. */
export type Effect = { wgsl: string; uniforms?: Uniforms; textures?: Textures } | { bloom: BloomOptions }

export interface BloomOptions {
  /** How much of the spread light is added. 0.5 if not given. */
  strength?: number
  /** How bright light has to be to spread, where 1 is white. 0.8 if not given. */
  threshold?: number
  /** How far it spreads, from 0 to 1. 0.5 if not given. */
  radius?: number
}

/** Light that spreads around what is bright: glowing things glow. */
export function bloom(options: BloomOptions = {}): Effect {
  return { bloom: options }
}

const TONES = { none: 0, neutral: 1, aces: 2 } as const

/**
 * A box with a scene in 3D in it. Without a camera in it, it is seen from `[0, 0, 5]` toward the
 * middle; without lights, by a soft light from the sky and one from the top right.
 */
export function Scene3D(props: Scene3DProps): JSXNode {
  const frame = useCurrentFrame()
  return nodeChild(() => {
    const node = cmd.createNode(cmd.KIND_SCENE)
    onCleanup(() => cmd.removeNode(node))
    if (props.style) bindStyle(node, props.style)
    bind(props.background, (c) => cmd.setParam(node, cmd.P.BACKGROUND, linearColor(c)))
    bind(props.toneMapping, (t) => cmd.setParam(node, cmd.P.TONE_MAPPING, [TONES[t]]))
    bind(props.exposure, (e) => cmd.setParam(node, cmd.P.EXPOSURE, [e]))
    const [timed, setTimed] = createSignal(false)
    createRenderEffect(() => {
      if (timed()) untrack(() => bindTime(node, frame))
    })
    ;(props.effects ?? []).forEach((e, i) => {
      if ("bloom" in e) {
        const b = e.bloom
        cmd.setParam(node, cmd.P.EFFECT, [i, 1, b.strength ?? 0.5, b.threshold ?? 0.8, b.radius ?? 0.5])
        return
      }
      const info = compileShader(e.wgsl, STAGE_EFFECT)
      if (info.usesTime) setTimed(true)
      cmd.setParam(node, cmd.P.EFFECT, [i, 0, info.id])
      bindUniforms(node, info, e.uniforms, cmd.P.EFFECT_UNIFORM, [i])
      bindTextures(node, info, e.textures, (t) => i * 256 + t, cmd.TEXT_EFFECT_TEXTURE, cmd.P.EFFECT_VIDEO)
    })
    // What panels show, laid out in the box where they aren't seen.
    const [held, setHeld] = createSignal<number[]>([])
    const space: Space = {
      group: (visible, children) => thing(cmd.KIND_GROUP, { visible, children }, () => {}),
      needTime: () => setTimed(true),
      hold: (n) => {
        setHeld((list) => [...list, n])
        onCleanup(() => setHeld((list) => list.filter((x) => x !== n)))
      },
    }
    new Host(node).mount(provide(SpaceContext, space, [props.children, () => held().map(existingNode)]))
    props.ref?.(node)
    return node
  })
}

// --- Things -------------------------------------------------------------------------------------

/** Makes a thing of `kind`, with the place `props` gives it, and what `more` sets. */
function thing(kind: number, props: Object3DProps, more: (node: number) => void): JSXNode {
  const space = useContext(SpaceContext)
  if (!space) throw new Error("things in 3D go in a <Scene3D>")
  return nodeChild(() => {
    const node = cmd.createNode(kind)
    onCleanup(() => cmd.removeNode(node))
    bind(props.position, (p) => cmd.setParam(node, cmd.P.POSITION, vec3(p)))
    bind(props.rotation, (r) => cmd.setParam(node, cmd.P.ROTATION, vec3(r)))
    bind(props.quaternion, (q) => cmd.setParam(node, cmd.P.QUATERNION, q ?? []))
    bind(props.scale, (s) => cmd.setParam(node, cmd.P.SCALE, typeof s === "number" ? [s] : vec3(s)))
    bind(props.lookAt, (t) => cmd.setParam(node, cmd.P.LOOK_AT, t ? vec3(t) : []))
    bind(props.visible, (v) => cmd.setParam(node, cmd.P.VISIBLE, [v ? 1 : 0]))
    more(node)
    new Host(node).mount(props.children)
    return node
  })
}

/** Things that move together. */
export function Group(props: Object3DProps): JSXNode {
  return thing(cmd.KIND_GROUP, props, () => {})
}

/** A shape of its own, with a material. */
export function Mesh(props: MeshProps): JSXNode {
  return mesh(props, () => read(props.geometry), (g) => custom(g))
}

/** A box, `size` across (one number for a cube). */
export function Box(props: ShapeProps & { size?: MaybeAccessor<number | Vec3Like> }): JSXNode {
  return mesh(props, props.size ?? 1, (s) => [SHAPE.BOX, ...(typeof s === "number" ? [s, s, s] : vec3(s))])
}

export function Sphere(props: ShapeProps & { radius?: MaybeAccessor<number>; segments?: [number, number] }): JSXNode {
  const [w, h] = props.segments ?? [48, 32]
  return mesh(props, props.radius ?? 1, (r) => [SHAPE.SPHERE, r, w, h])
}

/**
 * A flat rectangle in the XY plane, facing +Z: turn it by `[-90, 0, 0]` for a floor. `segments`
 * cuts it into pieces across and down, for a material that bends it.
 */
export function Plane(
  props: ShapeProps & { size?: MaybeAccessor<number | readonly [number, number]>; segments?: [number, number] },
): JSXNode {
  const [across, down] = props.segments ?? [1, 1]
  return mesh(props, props.size ?? 1, (s) => [SHAPE.PLANE, ...(typeof s === "number" ? [s, s] : s), across, down])
}

/** Along Y, `height` high, its middle at its position. */
export function Cylinder(
  props: ShapeProps & {
    radius?: MaybeAccessor<number>
    radiusTop?: MaybeAccessor<number>
    radiusBottom?: MaybeAccessor<number>
    height?: MaybeAccessor<number>
    segments?: number
  },
): JSXNode {
  const radius = props.radius ?? 1
  const size = () => [
    read(props.radiusTop ?? radius),
    read(props.radiusBottom ?? radius),
    read(props.height ?? 1),
  ]
  return mesh(props, size, ([t, b, h]) => [SHAPE.CYLINDER, t, b, h, props.segments ?? 48])
}

/** A cylinder with a point at the top. */
export function Cone(
  props: ShapeProps & { radius?: MaybeAccessor<number>; height?: MaybeAccessor<number>; segments?: number },
): JSXNode {
  return Cylinder({ ...props, radiusTop: 0, radiusBottom: props.radius ?? 1 })
}

/** A ring in the XY plane: `radius` to the middle of the tube, `tube` the radius of the tube. */
export function Torus(
  props: ShapeProps & { radius?: MaybeAccessor<number>; tube?: MaybeAccessor<number>; segments?: [number, number] },
): JSXNode {
  const [radial, tubular] = props.segments ?? [24, 64]
  const size = () => [read(props.radius ?? 1), read(props.tube ?? 0.4)]
  return mesh(props, size, ([r, t]) => [SHAPE.TORUS, r, t, radial, tubular])
}

const SHAPE = { BOX: 0, SPHERE: 1, PLANE: 2, CYLINDER: 3, TORUS: 4, CUSTOM: 5 } as const

function mesh<T>(props: ShapeProps, size: MaybeAccessor<T>, shape: (size: T) => ArrayLike<number>): JSXNode {
  const space = useContext(SpaceContext)
  const m = props.material ?? {}
  const shader = m.wgsl === undefined ? null : compileShader(m.wgsl, STAGE_MATERIAL)
  if (shader?.usesTime) space?.needTime()
  return thing(cmd.KIND_MESH, props, (node) => {
    bind(size, (s) => cmd.setParam(node, cmd.P.GEOMETRY, shape(s)))
    bind(m.color, (c) => cmd.setParam(node, cmd.P.COLOR, linearColor(c)))
    bind(m.metalness, (v) => cmd.setParam(node, cmd.P.METALNESS, [v]))
    bind(m.roughness, (v) => cmd.setParam(node, cmd.P.ROUGHNESS, [v]))
    if (m.emissive !== undefined || m.emissiveIntensity !== undefined) {
      const emissive = m.emissive ?? "#ffffff"
      bind(() => [read(emissive), read(m.emissiveIntensity ?? 1)] as const, ([c, k]) => {
        const [r, g, b] = linearColor(c)
        cmd.setParam(node, cmd.P.EMISSIVE, [r * k, g * k, b * k])
      })
    }
    bind(m.opacity, (v) => cmd.setParam(node, cmd.P.OPACITY, [v]))
    bind(m.doubleSided, (v) => cmd.setParam(node, cmd.P.DOUBLE_SIDED, [v ? 1 : 0]))
    bind(m.transparent, (v) => cmd.setParam(node, cmd.P.TRANSPARENT, [v ? 1 : 0]))
    bind(props.castShadow, (v) => cmd.setParam(node, cmd.P.CAST_SHADOW, [v ? 1 : 0]))
    bind(props.receiveShadow, (v) => cmd.setParam(node, cmd.P.RECEIVE_SHADOW, [v ? 1 : 0]))
    const map = m.map
    if (isVideoTexture(map)) cmd.setParam(node, cmd.P.VIDEO_MAP, [videoTextureNode(map)])
    else bind(map, (src) => cmd.setParamText(node, cmd.TEXT_MAP, 0, src))
    if (shader) {
      cmd.setParam(node, cmd.P.SHADER, [shader.id])
      bindUniforms(node, shader, m.uniforms)
      bindTextures(node, shader, m.textures)
    }
  })
}

function custom(g: GeometryData): number[] {
  const n = g.positions.length / 3
  if (!Number.isInteger(n)) throw new Error("a shape's positions are three numbers per vertex")
  const out = [SHAPE.CUSTOM, n, g.indices?.length ?? 0, g.normals ? 1 : 0, g.uvs ? 1 : 0]
  const push = (a: ArrayLike<number> | undefined, per: number, what: string) => {
    if (!a) return
    if (a.length !== n * per) throw new Error(`a shape with ${n} vertices has ${n * per} ${what}, not ${a.length}`)
    for (let i = 0; i < a.length; i++) out.push(a[i])
  }
  push(g.positions, 3, "position numbers")
  push(g.normals, 3, "normal numbers")
  push(g.uvs, 2, "uv numbers")
  if (g.indices) for (let i = 0; i < g.indices.length; i++) out.push(g.indices[i])
  return out
}

// --- Models -------------------------------------------------------------------------------------

export interface ModelProps extends Object3DProps {
  /** A glTF file (`.glb` or `.gltf`) of the project. */
  src: string
  /** Which of its animations plays, by name or index; none if not given. */
  animation?: MaybeAccessor<string | number | null>
  /**
   * Where in the animation it is, in seconds. If not given, the time of the clip, times `speed`,
   * over and over unless `loop` is false.
   */
  time?: MaybeAccessor<number>
  speed?: number
  loop?: boolean
  castShadow?: MaybeAccessor<boolean>
  receiveShadow?: MaybeAccessor<boolean>
}

export interface ModelInfo {
  animations: { name: string; duration: number }[]
}

const models = new Map<string, ModelInfo>()

/** What the glTF model in `src` has: its animations, by name, and how long they are. */
export function modelInfo(src: string): ModelInfo {
  let info = models.get(src)
  if (!info) {
    info = { animations: ops.modelInfo(src).animations.map(([name, duration]) => ({ name, duration })) }
    models.set(src, info)
  }
  return info
}

/**
 * A glTF model: its nodes, meshes, materials and pictures, posed by one of its animations (skins
 * included). What it shows at a frame depends on the time alone.
 */
export function Model(props: ModelProps): JSXNode {
  const info = modelInfo(props.src)
  const frame = useCurrentFrame()
  const indexOf = (a: string | number | null | undefined): number => {
    if (a === null || a === undefined) return -1
    const i = typeof a === "number" ? a : info.animations.findIndex((x) => x.name === a)
    if (i < 0 || i >= info.animations.length) {
      const names = info.animations.map((x) => x.name)
      throw new Error(
        `${props.src} has no animation ${JSON.stringify(a)}` +
          (names.length ? ` (it has ${names.join(", ")})` : " (it has none)"),
      )
    }
    return i
  }
  return thing(cmd.KIND_MODEL, props, (node) => {
    cmd.setParamText(node, cmd.TEXT_MODEL, 0, props.src)
    bind(props.castShadow, (v) => cmd.setParam(node, cmd.P.CAST_SHADOW, [v ? 1 : 0]))
    bind(props.receiveShadow, (v) => cmd.setParam(node, cmd.P.RECEIVE_SHADOW, [v ? 1 : 0]))
    if (props.animation === undefined) return
    const animation = typeof props.animation === "function"
      ? () => indexOf((props.animation as Accessor<string | number | null>)())
      : indexOf(props.animation)
    bind(animation, (i) => cmd.setParam(node, cmd.P.ANIMATION, i < 0 ? [] : [i]))
    const time = props.time ?? (() => {
      const i = read(animation)
      const t = framesToSeconds(frame()) * (props.speed ?? 1)
      const d = i < 0 ? 0 : info.animations[i].duration
      return props.loop === false || d <= 0 ? t : ((t % d) + d) % d
    })
    bind(time, (t) => cmd.setParam(node, cmd.P.ANIMATION_TIME, [t]))
  })
}

// --- Panels -------------------------------------------------------------------------------------

export interface PanelProps extends Object3DProps {
  /** Of the box the 2D is in, which is as big as it is unless this says. */
  style?: StyleProp
  /** How many of its pixels make a unit of the scene. 100 if not given. */
  pixelsPerUnit?: MaybeAccessor<number>
  /** Light falls on it. If not, it shows its colors as they are, as on the screen. */
  lit?: MaybeAccessor<boolean>
  doubleSided?: MaybeAccessor<boolean>
  /** What is shown on it: anything of 2D (`<div>`, `<text>`, `<img>`, `<Video>`, `<Shader>`…). */
  children?: JSXNode
}

/**
 * 2D in a scene: what is in it is laid out as anywhere else, and shown on a rectangle in the XY plane
 * facing +Z, its middle at the panel's position, as many units across as its pixels say.
 */
export function Panel(props: PanelProps): JSXNode {
  const space = useContext(SpaceContext)
  return thing(cmd.KIND_PANEL, { ...props, children: undefined }, (node) => {
    // Laid out in the scene's box, out of the way of the rest, but seen only on the panel.
    const box = cmd.createNode(cmd.KIND_ELEMENT)
    onCleanup(() => cmd.removeNode(box))
    cmd.setParam(box, cmd.P.OFFSCREEN, [1])
    bindStyle(box, { position: "absolute", left: 0, top: 0, display: "flex", flexDirection: "column" })
    if (props.style) bindStyle(box, props.style)
    new Host(box).mount(props.children)
    space!.hold(box)
    cmd.setParam(node, cmd.P.PANEL, [box])
    bind(props.pixelsPerUnit, (v) => cmd.setParam(node, cmd.P.PIXELS_PER_UNIT, [v]))
    bind(props.lit, (v) => cmd.setParam(node, cmd.P.LIT, [v ? 1 : 0]))
    bind(props.doubleSided, (v) => cmd.setParam(node, cmd.P.DOUBLE_SIDED, [v ? 1 : 0]))
  })
}

// --- Cameras ------------------------------------------------------------------------------------

interface CameraProps extends Object3DProps {
  near?: MaybeAccessor<number>
  far?: MaybeAccessor<number>
  /**
   * Whether the scene is seen through it. Of those that are, the last one is used: give this a
   * function to cut from one to another.
   */
  active?: MaybeAccessor<boolean>
}

/** Looks down its -Z. */
export function PerspectiveCamera(props: CameraProps & { fov?: MaybeAccessor<number> }): JSXNode {
  return thing(cmd.KIND_CAMERA, props, (node) => {
    cameraParams(node, props)
    bind(props.fov, (f) => cmd.setParam(node, cmd.P.FOV, [f]))
  })
}

/** Sees `height` units from the bottom of the box to its top, whatever the distance. */
export function OrthographicCamera(props: CameraProps & { height?: MaybeAccessor<number> }): JSXNode {
  return thing(cmd.KIND_CAMERA, props, (node) => {
    cmd.setParam(node, cmd.P.ORTHOGRAPHIC, [1])
    cameraParams(node, props)
    bind(props.height ?? 10, (h) => cmd.setParam(node, cmd.P.FOV, [h]))
  })
}

function cameraParams(node: number, props: CameraProps) {
  bind(props.near, (v) => cmd.setParam(node, cmd.P.NEAR, [v]))
  bind(props.far, (v) => cmd.setParam(node, cmd.P.FAR, [v]))
  bind(props.active, (v) => cmd.setParam(node, cmd.P.ACTIVE, [v ? 1 : 0]))
}

// --- Lights -------------------------------------------------------------------------------------

interface LightProps extends Object3DProps {
  color?: MaybeAccessor<string>
  intensity?: MaybeAccessor<number>
}

interface ShadowProps {
  /**
   * Whether what it lights casts shadows. A directional light's shadows cover what casts them,
   * wherever it is; a spot's, its cone. Up to four lights of a scene cast shadows.
   */
  castShadow?: MaybeAccessor<boolean>
}

const LIGHT = { AMBIENT: 0, DIRECTIONAL: 1, POINT: 2, SPOT: 3, HEMISPHERE: 4 } as const

function light(kind: number, props: LightProps & ShadowProps, more: (node: number) => void = () => {}): JSXNode {
  return thing(cmd.KIND_LIGHT, props, (node) => {
    cmd.setParam(node, cmd.P.LIGHT, [kind])
    bind(props.castShadow, (v) => cmd.setParam(node, cmd.P.CAST_SHADOW, [v ? 1 : 0]))
    bind(props.color, (c) => cmd.setParam(node, cmd.P.LIGHT_COLOR, linearColor(c).slice(0, 3)))
    bind(props.intensity, (v) => cmd.setParam(node, cmd.P.INTENSITY, [v]))
    more(node)
  })
}

/** Light from everywhere alike. */
export function AmbientLight(props: LightProps): JSXNode {
  return light(LIGHT.AMBIENT, props)
}

/** Light from the sky (`color`) above and the ground (`groundColor`) below. */
export function HemisphereLight(props: LightProps & { groundColor?: MaybeAccessor<string> }): JSXNode {
  return light(LIGHT.HEMISPHERE, props, (node) => {
    bind(props.groundColor, (c) => cmd.setParam(node, cmd.P.GROUND_COLOR, linearColor(c).slice(0, 3)))
  })
}

/** Light from far away, from `position` toward `lookAt` (the middle of the scene if not given). */
export function DirectionalLight(props: LightProps & ShadowProps): JSXNode {
  return light(LIGHT.DIRECTIONAL, props)
}

/**
 * Light from a point, as bright as `intensity` at a distance of 1, and less with the square of the
 * distance; none past `range` if it is given.
 */
export function PointLight(props: LightProps & { range?: MaybeAccessor<number> }): JSXNode {
  return light(LIGHT.POINT, props, (node) => bind(props.range, (v) => cmd.setParam(node, cmd.P.RANGE, [v])))
}

/** A point light that shines in a cone toward `lookAt`: `angle` degrees from its middle to its edge. */
export function SpotLight(
  props: LightProps & ShadowProps & {
    range?: MaybeAccessor<number>
    angle?: MaybeAccessor<number>
    /** How much of the cone fades toward its edge, from 0 to 1. */
    penumbra?: MaybeAccessor<number>
  },
): JSXNode {
  return light(LIGHT.SPOT, props, (node) => {
    bind(props.range, (v) => cmd.setParam(node, cmd.P.RANGE, [v]))
    bind(props.angle, (v) => cmd.setParam(node, cmd.P.ANGLE, [v]))
    bind(props.penumbra, (v) => cmd.setParam(node, cmd.P.PENUMBRA, [v]))
  })
}

// --- Helpers ------------------------------------------------------------------------------------

/**
 * A point on a circle around `center`, in the XZ plane: `angle` degrees from +Z toward +X, at
 * `height` above it. For a camera that goes round:
 * `position={() => orbit({ radius: 6, angle: frame() })} lookAt={[0, 0, 0]}`.
 */
export function orbit(o: { radius: number; angle: number; height?: number; center?: Vec3Like }): [number, number, number] {
  const [cx, cy, cz] = o.center ? vec3(o.center) : [0, 0, 0]
  const a = (o.angle * Math.PI) / 180
  return [cx + o.radius * Math.sin(a), cy + (o.height ?? 0), cz + o.radius * Math.cos(a)]
}

/** The time of the clip in seconds, for what moves on its own. */
export function useTime(): Accessor<number> {
  const frame = useCurrentFrame()
  return () => framesToSeconds(frame())
}

function vec3(v: Vec3Like): [number, number, number] {
  if (Array.isArray(v)) return [v[0], v[1], v[2]]
  const p = v as Vec3
  return [p.x, p.y, p.z]
}

function read<T>(v: MaybeAccessor<T>): T {
  return typeof v === "function" ? (v as Accessor<T>)() : v
}

/** Sends `value` with `send`, and again whenever it changes if it is a function. */
function bind<T>(value: MaybeAccessor<T> | undefined, send: (v: T) => void): void {
  if (value === undefined) return
  if (typeof value === "function") {
    createRenderEffect(() => {
      const v = (value as Accessor<T>)()
      untrack(() => send(v))
    })
  } else {
    send(value)
  }
}
