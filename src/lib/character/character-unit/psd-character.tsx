import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  PsdCharacterElement as PsdElm,
  type MotionClipNode,
  type CharacterNode,
  type DeclareAnimationNode,
  type DeclareVariableNode,
  type MotionNode,
  type MotionSequenceNode,
  type VoiceNode,
} from "./ast"
import { readPsd, type Psd } from "ag-psd"
import { parsePsdCharacter } from "./parser"
import { getSchema } from "ag-psd-psdtool"
import {
  useAnimation,
  useVariable,
  type Variable,
  type VariableType,
} from "../../animation"
import { useCurrentFrame, useGlobalCurrentFrame } from "../../frame"
import { Sound } from "../../sound/sound"
import { Clip, ClipSequence, useClipActive } from "../../clip"
import { useAudioSegments } from "../../audio-plan"
import { useWaveformBank } from "../../sound/character"

type PsdCharacterProps = {
  psd: string
  className?: string
  children: React.ReactNode
}

type PsdPath = {
  path: string
}

type PsdOptions = Record<string, any>
const imageDataCanvasCache = new WeakMap<object, HTMLCanvasElement>()

type PsdTracker = {
  pending: number
  start: () => () => void
  wait: () => Promise<void>
}

const PSD_TRACKER_KEY = "__frameScript_PsdTracker"
const psdFrameCallbacks = new Map<string, (frame: number) => Promise<void>>()

const getPsdTracker = (): PsdTracker => {
  const g = globalThis as unknown as Record<string, unknown>
  const existing = g[PSD_TRACKER_KEY] as PsdTracker | undefined
  if (existing) return existing

  let pending = 0
  const waiters = new Set<() => void>()

  const notifyIfReady = () => {
    if (pending !== 0) return
    for (const resolve of Array.from(waiters)) {
      resolve()
    }
    waiters.clear()
  }

  const tracker: PsdTracker = {
    get pending() {
      return pending
    },
    start: () => {
      pending += 1
      let done = false
      return () => {
        if (done) return
        done = true
        pending = Math.max(0, pending - 1)
        notifyIfReady()
      }
    },
    wait: () => {
      if (pending === 0) return Promise.resolve()
      return new Promise<void>((resolve) => {
        waiters.add(resolve)
      })
    },
  }

  g[PSD_TRACKER_KEY] = tracker
  return tracker
}

const waitForAnimationTick = () =>
  new Promise<void>((resolve) => {
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      setTimeout(resolve, 0)
      return
    }
    window.requestAnimationFrame(() => resolve())
  })

const installPsdApi = () => {
  if (typeof window === "undefined") return
  const tracker = getPsdTracker()
  const waitPsdReady = async () => {
    while (true) {
      if (tracker.pending === 0) {
        await waitForAnimationTick()
        if (tracker.pending === 0) return
      }
      await tracker.wait()
    }
  }

  const waitPsdFrame = async (frame: number) => {
    if (tracker.pending > 0) {
      await waitPsdReady()
    }
    const callbacks = Array.from(psdFrameCallbacks.values())
    if (callbacks.length > 0) {
      await Promise.all(callbacks.map((cb) => cb(frame)))
    }
    if (tracker.pending > 0) {
      await waitPsdReady()
    }
  }

  ;(window as any).__frameScript = {
    ...(window as any).__frameScript,
    waitPsdReady,
    waitPsdFrame,
    getPsdPending: () => tracker.pending,
  }
}

if (typeof window !== "undefined") {
  installPsdApi()
}

type PsdLayerLike = {
  name?: string
  hidden?: boolean
  canvas?: HTMLCanvasElement
  imageData?:
    | ImageData
    | { width: number; height: number; data: Uint8ClampedArray }
  left?: number
  top?: number
  children?: PsdLayerLike[]
}

const parsePsdToolName = (rawName: string | undefined) => {
  let name = rawName || ""
  const tags = new Set<string>()
  if (name.startsWith("!")) {
    tags.add("fixed")
    name = name.slice(1)
  } else if (name.startsWith("*")) {
    tags.add("option")
    name = name.slice(1)
  }
  while (true) {
    if (name.endsWith(":flipx")) {
      tags.add("flipx")
      name = name.slice(0, -":flipx".length)
    } else if (name.endsWith(":flipy")) {
      tags.add("flipy")
      name = name.slice(0, -":flipy".length)
    } else if (name.endsWith(":flipxy")) {
      tags.add("flipxy")
      name = name.slice(0, -":flipxy".length)
    } else {
      break
    }
  }
  return { name, tags }
}

const optionMatchesFlip = (
  tags: Set<string>,
  flipx: boolean,
  flipy: boolean,
) => {
  if (tags.has("flipxy") && flipx && flipy) return true
  if (tags.has("flipx") && flipx && !flipy) return true
  if (tags.has("flipy") && !flipx && flipy) return true
  return (
    !tags.has("flipxy") &&
    !tags.has("flipx") &&
    !tags.has("flipy") &&
    !flipx &&
    !flipy
  )
}

const applyPsdDefaults = (psdFile: Psd, data: PsdOptions) => {
  const schema = getSchema(psdFile) as {
    properties?: Record<string, { default?: unknown }>
  }
  const properties = schema.properties ?? {}
  for (const [key, value] of Object.entries(properties)) {
    if (data[key] === undefined && value.default !== undefined) {
      data[key] = value.default
    }
  }
  return schema
}

const canvasFromImageData = (
  imageData:
    | ImageData
    | { width: number; height: number; data: Uint8ClampedArray },
) => {
  const cached = imageDataCanvasCache.get(imageData)
  if (cached) return cached

  const canvasElement = document.createElement("canvas")
  canvasElement.width = imageData.width
  canvasElement.height = imageData.height
  const ctx = canvasElement.getContext("2d")
  if (!ctx) return canvasElement
  const sourceData = new Uint8ClampedArray(imageData.data)
  ctx.putImageData(
    new ImageData(sourceData, imageData.width, imageData.height),
    0,
    0,
  )
  imageDataCanvasCache.set(imageData, canvasElement)
  return canvasElement
}

const layerToCanvas = (layer: PsdLayerLike) => {
  if (layer.canvas) return layer.canvas
  if (layer.imageData) return canvasFromImageData(layer.imageData)
  return null
}

const renderPsdImageData = (
  psdFile: Psd,
  data: PsdOptions,
  canvasElement: HTMLCanvasElement,
  renderOptions?: { flipx?: boolean; flipy?: boolean },
) => {
  applyPsdDefaults(psdFile, data)
  const flipx = renderOptions?.flipx ?? false
  const flipy = renderOptions?.flipy ?? false
  const root = psdFile as PsdLayerLike
  const queue: PsdLayerLike[] = [root]
  const ancestors: PsdLayerLike[] = []
  const visibleLeaves: PsdLayerLike[] = []

  while (queue.length) {
    const node = queue.shift()
    if (!node) break
    const info = parsePsdToolName(node.name)

    if (node !== root) {
      while (ancestors.length && !ancestors.at(-1)?.children?.includes(node)) {
        ancestors.pop()
      }
      ancestors.push(node)
    }

    const currentPath = ancestors
      .map((layer) => parsePsdToolName(layer.name).name)
      .join("/")
    const visible =
      data[currentPath] !== false ||
      info.tags.has("fixed") ||
      info.tags.has("option") ||
      node === root
    if (!visible) continue

    if (node.children?.length) {
      const sameNameCounts = new Map<string, number>()
      for (const child of node.children) {
        const childName = parsePsdToolName(child.name).name
        sameNameCounts.set(childName, (sameNameCounts.get(childName) ?? 0) + 1)
      }
      const duplicated = new Set(
        Array.from(sameNameCounts.entries())
          .filter(([, count]) => count > 1)
          .map(([name]) => name),
      )

      queue.unshift(
        ...node.children.filter((child) => {
          const childInfo = parsePsdToolName(child.name)
          if (
            childInfo.tags.has("option") &&
            data[currentPath] !== childInfo.name
          ) {
            return false
          }
          if (duplicated.has(childInfo.name)) {
            return optionMatchesFlip(childInfo.tags, flipx, flipy)
          }
          return true
        }),
      )
    } else {
      visibleLeaves.push(node)
    }
  }

  canvasElement.width = psdFile.width
  canvasElement.height = psdFile.height
  const ctx = canvasElement.getContext("2d")
  if (!ctx) return canvasElement
  ctx.clearRect(0, 0, canvasElement.width, canvasElement.height)
  ctx.save()
  ctx.scale(flipx ? -1 : 1, flipy ? -1 : 1)
  ctx.translate(
    flipx ? -canvasElement.width : 0,
    flipy ? -canvasElement.height : 0,
  )
  for (const layer of visibleLeaves) {
    const source = layerToCanvas(layer)
    if (!source) continue
    ctx.drawImage(source, layer.left ?? 0, layer.top ?? 0)
  }
  ctx.restore()
  return canvasElement
}

const usePsdPending = () => {
  const loadIdRef = useRef(0)
  const pendingFinishRef = useRef<(() => void) | null>(null)

  const beginPending = useCallback(() => {
    loadIdRef.current += 1
    if (!pendingFinishRef.current) {
      pendingFinishRef.current = getPsdTracker().start()
    }
    return loadIdRef.current
  }, [])

  const endPending = useCallback(() => {
    if (pendingFinishRef.current) {
      pendingFinishRef.current()
      pendingFinishRef.current = null
    }
  }, [])

  useEffect(() => () => endPending(), [endPending])

  return { beginPending, endPending, loadIdRef }
}

/**
 * Option register system for PSD rendering.
 * Each runtime node registers its own partial options,
 * which are later merged into a single PSD option object.
 *
 * PSD描画のためのオプション登録システム。
 * 各ノードが部分的なオプションを登録し、
 * 最終的にそれらをマージして1つのオプションにする。
 */
type OptionRegister = () => {
  update: (opt: Record<string, any>) => void
  getter: () => Record<string, any>
  unregister: () => void
}

/**
 * Create an animation system using PSD synchronized with audio.
 * Renders the PSD onto a canvas.
 *
 * Important:
 * Hooks cannot be used inside DSL children.
 *
 * 音声と同期したPSDアニメーションを構築するコンポーネント。
 * canvas上にPSDを描画する。
 *
 * 注意:
 * DSL内部ではReactフックは使用不可
 *
 * @example
 * ```typescript
 * <PsdCharacter psd="../assets/character.psd" className="character">
 *   <Voice voice="voice.wav"/>
 * </PsdCharacter>
 * ```
 */
export const PsdCharacter = ({
  psd,
  className,
  children,
}: PsdCharacterProps) => {
  const [myPsd, setPsd] = useState<Psd | undefined>(undefined)
  const [ast, setAst] = useState<CharacterNode | undefined>(undefined)
  const myPsdRef = useRef<Psd | undefined>(undefined)
  const active = useClipActive()
  const { beginPending, endPending, loadIdRef } = usePsdPending()
  const waitPsdIdRef = useRef(`psd-${Math.random().toString(36).slice(2)}`)
  const scheduledDrawRef = useRef<number | null>(null)
  const renderBufferRef = useRef<HTMLCanvasElement | null>(null)

  /**
   * Registry storing per-node options.
   * Key = node id, Value = partial PSD options.
   *
   * ノードごとのオプションを保持するレジストリ
   */
  const registry = useRef(new Map<string, PsdOptions>())

  /**
   * Order of registration (important for layering / precedence).
   *
   * 登録順序（レイヤー優先度に影響）
   */
  const order = useRef<string[]>([])

  /**
   * Final merged options used for rendering.
   *
   * 描画に使われる最終的なオプション
   */
  const options = useRef<PsdOptions>({})

  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    myPsdRef.current = myPsd
  }, [myPsd])

  const drawPsd = useCallback(() => {
    const psdFile = myPsdRef.current
    const canvasElement = canvas.current
    if (!psdFile || !canvasElement) return false

    const buffer = renderBufferRef.current ?? document.createElement("canvas")
    renderBufferRef.current = buffer
    renderPsdImageData(psdFile, options.current, buffer)

    canvasElement.width = buffer.width
    canvasElement.height = buffer.height
    const ctx = canvasElement.getContext("2d")
    if (!ctx) return false
    ctx.clearRect(0, 0, canvasElement.width, canvasElement.height)
    ctx.drawImage(buffer, 0, 0)
    return true
  }, [])

  const cancelScheduledDraw = useCallback(() => {
    if (scheduledDrawRef.current == null) return
    window.cancelAnimationFrame(scheduledDrawRef.current)
    scheduledDrawRef.current = null
  }, [])

  const scheduleDrawPsd = useCallback(() => {
    cancelScheduledDraw()
    scheduledDrawRef.current = window.requestAnimationFrame(() => {
      scheduledDrawRef.current = window.requestAnimationFrame(() => {
        scheduledDrawRef.current = null
        drawPsd()
      })
    })
  }, [cancelScheduledDraw, drawPsd])

  /**
   * Load PSD and parse DSL into AST.
   *
   * PSDのロードとDSLのAST変換
   */
  useEffect(() => {
    const loadId = beginPending()
    let alive = true

    setPsd(undefined)
    fetchPsd(normalizePsdPath(psd))
      .then((p) => {
        if (!alive || loadId !== loadIdRef.current) return
        setPsd(p)
      })
      .catch((error) => {
        console.error("PsdCharacter: failed to load psd", error)
      })
      .finally(() => {
        if (loadId === loadIdRef.current) {
          endPending()
        }
      })
    setAst(parsePsdCharacter(children))
    return () => {
      alive = false
      if (loadId === loadIdRef.current) {
        endPending()
      }
    }
  }, [beginPending, endPending, loadIdRef, psd])

  /**
   * Render PSD every frame.
   *
   * 毎フレームPSDを描画
   */
  const frame = useCurrentFrame()
  useEffect(() => {
    if (!active) {
      cancelScheduledDraw()
      return
    }

    // Draw only after the hidden clip has become visible and Chromium has
    // settled the canvas backing store. Rendering while display:none, or in
    // the same commit that flips visibility, can leave the canvas blank.
    scheduleDrawPsd()

    return cancelScheduledDraw
  }, [active, cancelScheduledDraw, frame, myPsd, scheduleDrawPsd])

  useEffect(() => {
    if (!active) return
    const id = waitPsdIdRef.current
    const waitForFrame = async (_targetFrame: number) => {
      await waitForAnimationTick()
      if (drawPsd()) {
        await waitForAnimationTick()
        return
      }
      await waitForAnimationTick()
      drawPsd()
      await waitForAnimationTick()
    }

    psdFrameCallbacks.set(id, waitForFrame)
    return () => {
      psdFrameCallbacks.delete(id)
    }
  }, [active, drawPsd])

  /**
   * Merge all registered options.
   *
   * 登録されたオプションをマージ
   */
  const recompute = useCallback(() => {
    const merged = Object.assign({}, ...registry.current.values())
    options.current = merged
  }, [])

  /**
   * Create a new option registration slot.
   * Each node uses this to contribute rendering options.
   *
   * 各ノードがオプションを登録するためのスロットを作成
   */
  const register = useCallback(() => {
    const id = crypto.randomUUID()

    registry.current.set(id, {})
    order.current.push(id)

    const update = (opt: PsdOptions) => {
      registry.current.set(id, opt)
      recompute()
    }

    const unregister = () => {
      registry.current.delete(id)
      order.current = order.current.filter((x) => x !== id)
      recompute()
    }

    /**
     * Get accumulated options before this node.
     * Used for layered evaluation.
     *
     * 自分より前に登録されたオプションを取得
     */
    const getter = () => {
      const index = order.current.indexOf(id)
      const prevIds = order.current.slice(0, index)
      const prevOptions = prevIds.map((i) => registry.current.get(i) ?? {})
      return Object.assign({}, ...prevOptions)
    }

    return {
      update,
      getter,
      unregister,
    }
  }, [])

  return (
    <>
      <canvas className={className} ref={canvas} />

      {/* Execute AST nodes */}
      {/* ASTノードを実行 */}
      {ast?.children.map((child, i) => {
        switch (child.type) {
          case PsdElm.MotionSequence:
            return (
              <MotionSequenceRuntime
                key={i}
                ast={child}
                variables={{}}
                register={register}
              />
            )
          case PsdElm.DeclareVariable:
            return (
              <DeclareVariableRuntime
                key={i}
                ast={child}
                variables={{}}
                initializingVariables={{}}
                register={register}
              />
            )
          case PsdElm.Voice:
            return (
              <VoiceRuntime
                key={i}
                ast={child}
                variables={{}}
                register={register}
              />
            )
          case PsdElm.Motion:
            return (
              <MotionRuntime
                key={i}
                ast={child}
                variables={{}}
                register={register}
              />
            )
          default:
            return null
        }
      })}
    </>
  )
}

type MotionSequenceRuntimeProps = {
  ast: MotionSequenceNode
  variables: Record<string, Variable<any>>
  register: OptionRegister
}

const MotionSequenceRuntime = ({
  ast,
  variables,
  register,
}: MotionSequenceRuntimeProps) => {
  const reg = useRef<ReturnType<OptionRegister>>(undefined)
  if (!reg.current) {
    reg.current = register()
  }
  const { update, getter, unregister } = reg.current

  useEffect(() => {
    return () => unregister()
  }, [])

  // 直列のため同じregisterを使う
  const curRegister: OptionRegister = useCallback(() => {
    return { update, getter, unregister: () => {} }
  }, [])

  return (
    <ClipSequence>
      {ast.children
        .map((child) => {
          switch (child.type) {
            case PsdElm.DeclareVariable:
              return (
                <DeclareVariableRuntime
                  ast={child}
                  variables={variables}
                  initializingVariables={{}}
                  register={curRegister}
                />
              )
            case PsdElm.MotionClip:
              return (
                <MotionClipRuntime
                  ast={child}
                  variables={variables}
                  register={curRegister}
                />
              )
            case PsdElm.Voice:
              return (
                <VoiceRuntime
                  ast={child}
                  variables={variables}
                  register={curRegister}
                />
              )
            case PsdElm.Motion:
              return (
                <MotionRuntime
                  ast={child}
                  variables={variables}
                  register={curRegister}
                />
              )
            default:
              return null
          }
        })
        .map((child, i) => (
          <Clip key={i}> {child} </Clip>
        ))}
    </ClipSequence>
  )
}

type DeclareVariableRuntimeProps = {
  ast: DeclareVariableNode
  variables: Record<string, Variable<any>>
  initializingVariables: Record<string, Variable<any>>
  register: OptionRegister
}

const useTypedVariable = (value: VariableType): Variable<VariableType> => {
  const useVariableForUnion = useVariable as (
    initial: VariableType,
  ) => Variable<VariableType>
  return useVariableForUnion(value)
}

const DeclareVariableRuntime = ({
  ast,
  variables,
  initializingVariables,
  register,
}: DeclareVariableRuntimeProps) => {
  // T extends VariableTypeとして
  // DeclareVariableで受け取る型がTなので
  // ast.initValue: T
  // であり、これを使う限り問題ない
  const variable = useTypedVariable(ast.initValue)
  const newInitVariables = {
    [ast.variableName]: variable,
    ...initializingVariables,
  }

  switch (ast.children.type) {
    case PsdElm.DeclareVariable:
      return (
        <DeclareVariableRuntime
          ast={ast.children}
          variables={variables}
          initializingVariables={newInitVariables}
          register={register}
        />
      )
    case PsdElm.DeclareAnimation:
      return (
        <DeclareAnimationRuntime
          ast={ast.children}
          variables={variables}
          initializingVariables={newInitVariables}
          register={register}
        />
      )
    default:
      return null
  }
}

type MotionClipRuntimeProps = {
  ast: MotionClipNode
  variables: Record<string, Variable<any>>
  register: OptionRegister
}

const MotionClipRuntime = ({
  ast,
  variables,
  register,
}: MotionClipRuntimeProps) => {
  const reg = useRef<ReturnType<OptionRegister>>(undefined)
  if (!reg.current) {
    reg.current = register()
  }
  const { update, getter: superGetter, unregister } = reg.current

  useEffect(() => {
    return () => unregister()
  }, [])

  const curRegistry = useRef(new Map<string, PsdOptions>())
  const order = useRef<string[]>([])

  const options = useRef<PsdOptions>({})

  const recompute = useCallback(() => {
    const merged = Object.assign({}, ...curRegistry.current.values())
    options.current = merged
  }, [])

  const curRegister = useCallback(() => {
    const id = crypto.randomUUID()

    curRegistry.current.set(id, {})
    order.current.push(id)

    const update = (opt: PsdOptions) => {
      curRegistry.current.set(id, opt)
      recompute()
    }

    const unregister = () => {
      curRegistry.current.delete(id)
      order.current = order.current.filter((x) => x !== id)
      recompute()
    }

    const getter = () => {
      const index = order.current.indexOf(id)

      const prevIds = order.current.slice(0, index)

      const prevOptions = prevIds.map((i) => curRegistry.current.get(i) ?? {})

      return Object.assign(superGetter(), ...prevOptions)
    }

    return {
      update,
      getter,
      unregister,
    }
  }, [])

  const frame = useCurrentFrame()
  useEffect(() => {
    update(options.current)
  }, [frame])

  return (
    <>
      {ast.children.map((child, i) => {
        switch (child.type) {
          case PsdElm.MotionSequence:
            return (
              <MotionSequenceRuntime
                key={i}
                ast={child}
                variables={variables}
                register={curRegister}
              />
            )
          case PsdElm.DeclareVariable:
            return (
              <DeclareVariableRuntime
                key={i}
                ast={child}
                variables={variables}
                initializingVariables={{}}
                register={curRegister}
              />
            )
          case PsdElm.Voice:
            return (
              <VoiceRuntime
                key={i}
                ast={child}
                variables={variables}
                register={curRegister}
              />
            )
          case PsdElm.Motion:
            return (
              <MotionRuntime
                key={i}
                ast={child}
                variables={variables}
                register={curRegister}
              />
            )
          default:
            return null
        }
      })}
    </>
  )
}

type DeclareAnimationRuntimeProps = {
  ast: DeclareAnimationNode
  variables: Record<string, Variable<any>>
  initializingVariables: Record<string, Variable<any>>
  register: OptionRegister
}

const DeclareAnimationRuntime = ({
  ast,
  variables,
  initializingVariables,
  register,
}: DeclareAnimationRuntimeProps) => {
  useAnimation(async (ctx) => {
    await ast.animation(ctx, initializingVariables)
  }, [])

  const curVariables = { ...variables, ...initializingVariables }

  const reg = useRef<ReturnType<OptionRegister>>(undefined)
  if (!reg.current) {
    reg.current = register()
  }
  const { update, getter: superGetter, unregister } = reg.current

  useEffect(() => {
    return () => unregister()
  }, [])

  const curRegistry = useRef(new Map<string, PsdOptions>())
  const order = useRef<string[]>([])

  const options = useRef<PsdOptions>({})

  const recompute = useCallback(() => {
    const merged = Object.assign({}, ...curRegistry.current.values())
    options.current = merged
  }, [])

  const curRegister = useCallback(() => {
    const id = crypto.randomUUID()

    curRegistry.current.set(id, {})
    order.current.push(id)

    const update = (opt: PsdOptions) => {
      curRegistry.current.set(id, opt)
      recompute()
    }

    const unregister = () => {
      curRegistry.current.delete(id)
      order.current = order.current.filter((x) => x !== id)
      recompute()
    }

    const getter = () => {
      const index = order.current.indexOf(id)

      const prevIds = order.current.slice(0, index)

      const prevOptions = prevIds.map((i) => curRegistry.current.get(i) ?? {})

      return Object.assign(superGetter(), ...prevOptions)
    }

    return {
      update,
      getter,
      unregister,
    }
  }, [])

  const frame = useCurrentFrame()
  useEffect(() => {
    update(options.current)
  }, [frame])

  return (
    <>
      {ast.children.map((child, i) => {
        switch (child.type) {
          case PsdElm.MotionSequence:
            return (
              <MotionSequenceRuntime
                key={i}
                ast={child}
                variables={curVariables}
                register={curRegister}
              />
            )
          case PsdElm.DeclareVariable:
            return (
              <DeclareVariableRuntime
                key={i}
                ast={child}
                variables={curVariables}
                initializingVariables={{}}
                register={curRegister}
              />
            )
          case PsdElm.Voice:
            return (
              <VoiceRuntime
                key={i}
                ast={child}
                variables={curVariables}
                register={curRegister}
              />
            )
          case PsdElm.Motion:
            return (
              <MotionRuntime
                key={i}
                ast={child}
                variables={curVariables}
                register={curRegister}
              />
            )
          default:
            return null
        }
      })}
    </>
  )
}

type VoiceRuntimeProps = {
  ast: VoiceNode
  variables: Record<string, Variable<any>>
  register: OptionRegister
}

const VoiceRuntime = (props: VoiceRuntimeProps) => {
  return (
    <Clip>
      {" "}
      <VoiceRuntimeInner {...props} />{" "}
    </Clip>
  )
}

const VoiceRuntimeInner = ({ ast, variables, register }: VoiceRuntimeProps) => {
  const reg = useRef<ReturnType<OptionRegister>>(undefined)
  if (!reg.current) {
    reg.current = register()
  }
  const { update, unregister } = reg.current

  useEffect(() => {
    return () => unregister()
  }, [])

  const localFrame = useCurrentFrame()
  const globalFrame = useGlobalCurrentFrame()
  const frames = [localFrame, globalFrame]
  const audioSegments = useAudioSegments()
  const audioSegment = useMemo(() => {
    return audioSegments.filter((seg) => seg.source.path == ast.voice).at(0)
  }, [ast, audioSegments])
  const waveformData = useWaveformBank([ast.voice])

  useEffect(() => {
    if (audioSegment && ast.voiceMotion) {
      update(
        ast.voiceMotion(
          audioSegment,
          waveformData.get(ast.voice) ?? null,
          variables,
          frames,
        ),
      )
    }
  }, [localFrame, audioSegment, waveformData])

  const volume =
    typeof ast.volume === "function"
      ? ast.volume(variables, frames)
      : ast.volume

  return (
    <Sound
      sound={ast.voice}
      trim={ast.trim}
      fadeInFrames={ast.fadeInFrames}
      fadeOutFrames={ast.fadeOutFrames}
      volume={volume}
      showWaveform={ast.showWaveform}
    />
  )
}

type MotionRuntimeProps = {
  ast: MotionNode
  variables: Record<string, Variable<any>>
  register: OptionRegister
}

const MotionRuntime = ({ ast, variables, register }: MotionRuntimeProps) => {
  const reg = useRef<ReturnType<OptionRegister>>(undefined)
  if (!reg.current) {
    reg.current = register()
  }
  const { update, unregister } = reg.current

  useEffect(() => {
    return () => unregister()
  }, [])

  const localTime = useCurrentFrame()
  const globalTime = useGlobalCurrentFrame()

  useEffect(() => {
    update(ast.motion(variables, [localTime, globalTime]))
  }, [localTime])

  return null
}

const psdCache = new Map<string, Psd>()
const psdPending = new Map<string, Promise<Psd>>()

const fetchPsd = async (psd: PsdPath): Promise<Psd> => {
  const cacheKey = `image-data:${psd.path}`
  const cached = psdCache.get(cacheKey)
  if (cached != null) return cached

  const pending = psdPending.get(cacheKey)
  if (pending) return pending

  const next = (async () => {
    const res = await fetch(buildPsdUrl(psd))
    if (!res.ok) {
      throw new Error("failed to fetch psd file")
    }

    const file = readPsd(await res.arrayBuffer(), { useImageData: true })
    psdCache.set(cacheKey, file)
    return file
  })().finally(() => {
    psdPending.delete(cacheKey)
  })

  psdPending.set(cacheKey, next)
  return next
}

const normalizePsdPath = (psd: PsdPath | string): PsdPath => {
  if (typeof psd === "string") return { path: psd }
  return psd
}

const buildPsdUrl = (pad: PsdPath) => {
  const url = new URL("http://localhost:3000/file")
  url.searchParams.set("path", pad.path)
  return url.toString()
}
