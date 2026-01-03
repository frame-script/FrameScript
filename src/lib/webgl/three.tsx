import { useEffect, useMemo, useRef, type CSSProperties } from "react"
import * as THREE from "three"
import { PROJECT_SETTINGS } from "../../../project/project"
import { useCurrentFrame } from "../frame"
import { useWebGLContext, useWebGLFrameWaiter, type WebGLContextLike } from "./index"

export type ThreeSize = {
  width: number
  height: number
  cssWidth: number
  cssHeight: number
  dpr: number
}

export type ThreeFrameState = {
  frame: number
  time: number
  delta: number
  fps: number
  size: ThreeSize
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.Camera
}

export type ThreeSetupResult = {
  scene: THREE.Scene
  camera: THREE.Camera
  update?: (state: ThreeFrameState) => void
  resize?: (state: Omit<ThreeFrameState, "frame" | "time" | "delta">) => void
  dispose?: () => void
}

export type ThreeInitContext = {
  renderer: THREE.WebGLRenderer
  gl: WebGLContextLike
  canvas: HTMLCanvasElement
  isWebGL2: boolean
  size: ThreeSize
}

export type ThreeCanvasProps = {
  setup: (ctx: ThreeInitContext) => ThreeSetupResult | Promise<ThreeSetupResult>
  style?: CSSProperties
  className?: string
  pixelRatio?: number
  clearColor?: THREE.ColorRepresentation
  clearAlpha?: number
  antialias?: boolean
  alpha?: boolean
  preserveDrawingBuffer?: boolean
  powerPreference?: WebGLPowerPreference
  onContextLost?: () => void
  onContextRestored?: () => void
  onContextFailed?: () => void
}

const resolveSize = (canvas: HTMLCanvasElement, pixelRatio?: number): ThreeSize => {
  const rect = canvas.getBoundingClientRect()
  const cssWidth = Math.max(1, Math.round(rect.width || PROJECT_SETTINGS.width || 1))
  const cssHeight = Math.max(1, Math.round(rect.height || PROJECT_SETTINGS.height || 1))
  const dpr = Math.max(1, pixelRatio ?? (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1))
  return {
    cssWidth,
    cssHeight,
    dpr,
    width: Math.max(1, Math.round(cssWidth * dpr)),
    height: Math.max(1, Math.round(cssHeight * dpr)),
  }
}

const resizeCamera = (camera: THREE.Camera, size: ThreeSize) => {
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = size.cssWidth / size.cssHeight
    camera.updateProjectionMatrix()
  }
}

/**
 * Disposes geometries and materials on a Three.js object tree.
 *
 * Three.js のジオメトリとマテリアルを破棄します。
 */
export const disposeThreeObject = (object: THREE.Object3D) => {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) {
      mesh.geometry.dispose()
    }
    const material = (mesh as THREE.Mesh).material
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose())
    } else if (material) {
      material.dispose()
    }
  })
}

/**
 * Renders a Three.js scene into a managed WebGL canvas.
 *
 * Three.js の描画と context lost 復旧をまとめて扱います。
 *
 * @example
 * ```tsx
 * const progress = useVariable(0)
 *
 * useAnimation(async (ctx) => {
 *   await ctx.move(progress).to(1, seconds(2))
 * }, [])
 *
 * <ThreeCanvas
 *   setup={({ renderer, size }) => {
 *     renderer.outputColorSpace = THREE.SRGBColorSpace
 *
 *     const scene = new THREE.Scene()
 *     const camera = new THREE.PerspectiveCamera(45, size.cssWidth / size.cssHeight, 0.1, 100)
 *     camera.position.z = 6
 *
 *     const mesh = new THREE.Mesh(
 *       new THREE.BoxGeometry(),
 *       new THREE.MeshStandardMaterial({ color: 0x44aa88 })
 *     )
 *     scene.add(mesh)
 *
 *     return {
 *       scene,
 *       camera,
 *       update: ({ frame }) => {
 *         const t = progress.get(frame)
 *         mesh.position.x = (t - 0.5) * 3
 *       },
 *       dispose: () => disposeThreeObject(mesh),
 *     }
 *   }}
 * />
 * ```
 */
export const ThreeCanvas = ({
  setup,
  style,
  className,
  pixelRatio,
  clearColor,
  clearAlpha = 1,
  antialias = true,
  alpha = true,
  preserveDrawingBuffer = false,
  powerPreference,
  onContextLost,
  onContextRestored,
  onContextFailed,
}: ThreeCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.Camera | null>(null)
  const updateRef = useRef<ThreeSetupResult["update"] | null>(null)
  const resizeRef = useRef<ThreeSetupResult["resize"] | null>(null)
  const disposeRef = useRef<ThreeSetupResult["dispose"] | null>(null)
  const sizeRef = useRef<ThreeSize | null>(null)
  const lastFrameRef = useRef<number | null>(null)

  const fps = PROJECT_SETTINGS.fps || 60
  const frame = useCurrentFrame()

  const { glRef } = useWebGLContext(
    canvasRef,
    async ({ gl, isWebGL2, canvas }) => {
      const renderer = new THREE.WebGLRenderer({
        canvas,
        context: gl,
        antialias,
        alpha,
        preserveDrawingBuffer,
        powerPreference,
      })
      rendererRef.current = renderer

      if (clearColor !== undefined) {
        renderer.setClearColor(clearColor, clearAlpha)
      } else if (alpha) {
        renderer.setClearColor(0x000000, 0)
      }

      const size = resolveSize(canvas, pixelRatio)
      sizeRef.current = size
      renderer.setPixelRatio(size.dpr)
      renderer.setSize(size.cssWidth, size.cssHeight, false)

      const result = await setup({ renderer, gl, canvas, isWebGL2, size })
      sceneRef.current = result.scene
      cameraRef.current = result.camera
      updateRef.current = result.update ?? null
      resizeRef.current = result.resize ?? null
      disposeRef.current = result.dispose ?? null

      resizeCamera(result.camera, size)
      if (result.resize) {
        result.resize({
          fps,
          size,
          renderer,
          scene: result.scene,
          camera: result.camera,
        })
      }

      return () => {
        disposeRef.current?.()
        disposeRef.current = null
        updateRef.current = null
        resizeRef.current = null
        sceneRef.current = null
        cameraRef.current = null
        renderer.dispose()
        rendererRef.current = null
      }
    },
    {
      onContextLost,
      onContextRestored,
      onContextFailed,
    },
  )

  useWebGLFrameWaiter(glRef)

  useEffect(() => {
    const renderer = rendererRef.current
    const scene = sceneRef.current
    const camera = cameraRef.current
    const canvas = canvasRef.current
    if (!renderer || !scene || !camera || !canvas) return

    const nextSize = resolveSize(canvas, pixelRatio)
    const prevSize = sizeRef.current
    if (!prevSize || prevSize.width !== nextSize.width || prevSize.height !== nextSize.height || prevSize.dpr !== nextSize.dpr) {
      sizeRef.current = nextSize
      renderer.setPixelRatio(nextSize.dpr)
      renderer.setSize(nextSize.cssWidth, nextSize.cssHeight, false)
      resizeCamera(camera, nextSize)
      resizeRef.current?.({
        fps,
        size: nextSize,
        renderer,
        scene,
        camera,
      })
    }

    if (clearColor !== undefined) {
      renderer.setClearColor(clearColor, clearAlpha)
    }

    const time = frame / fps
    const lastFrame = lastFrameRef.current
    const delta = lastFrame == null ? 0 : (frame - lastFrame) / fps
    lastFrameRef.current = frame

    updateRef.current?.({
      frame,
      time,
      delta,
      fps,
      size: sizeRef.current ?? nextSize,
      renderer,
      scene,
      camera,
    })

    renderer.render(scene, camera)
  }, [frame, fps, pixelRatio, clearColor, clearAlpha])

  const canvasStyle = useMemo(
    () => ({
      width: "100%",
      height: "100%",
      display: "block",
      ...style,
    }),
    [style],
  )

  return <canvas ref={canvasRef} className={className} style={canvasStyle} />
}

export { THREE }
