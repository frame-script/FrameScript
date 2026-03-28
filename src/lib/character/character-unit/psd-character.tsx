import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { PsdCharacterElement as PsdElm, type MotionClipNode, type CharacterNode, type DeclareAnimationNode, type DeclareVariableNode, type MotionNode, type MotionSequenceNode, type VoiceNode } from "./ast"
import { readPsd, type Psd } from "ag-psd"
import { parsePsdCharacter } from "./parser"
import { renderPsd } from "ag-psd-psdtool"
import { useAnimation, useVariable, type Variable } from "../../animation"
import { useCurrentFrame, useGlobalCurrentFrame } from "../../frame"
import { Sound } from "../../sound/sound"
import { Clip, ClipSequence } from "../../clip"
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
  children
}: PsdCharacterProps) => {
  const [myPsd, setPsd] = useState<Psd | undefined>(undefined)
  const [ast, setAst] = useState<CharacterNode | undefined>(undefined)

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

  /**
   * Load PSD and parse DSL into AST.
   *
   * PSDのロードとDSLのAST変換
   */
  useEffect(() => {
    fetchPsd(normalizePsdPath(psd)).then(p => setPsd(p))
    setAst(parsePsdCharacter(children))
  }, [psd])

  /**
   * Render PSD every frame.
   *
   * 毎フレームPSDを描画
   */
  const frame = useCurrentFrame()
  useEffect(() => {
    if (typeof myPsd !== "undefined" && canvas.current) {
      renderPsd(myPsd, options.current, { canvas: canvas.current })
    }
  }, [frame, myPsd])

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
      order.current = order.current.filter(x => x !== id)
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
      const prevOptions = prevIds.map(i => registry.current.get(i) ?? {})
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
            return <MotionSequenceRuntime key={i} ast={child} variables={{}} register={register} />
          case PsdElm.DeclareVariable:
            return <DeclareVariableRuntime key={i} ast={child} variables={{}} initializingVariables={{}} register={register} />
          case PsdElm.Voice:
            return <VoiceRuntime key={i} ast={child} variables={{}} register={register} />
          case PsdElm.Motion:
            return <MotionRuntime key={i} ast={child} variables={{}} register={register} />
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
  register
}: MotionSequenceRuntimeProps) => {
  const reg = useRef<ReturnType<OptionRegister>>(undefined)
  if (!reg.current) {
    reg.current = register()
  }
  const {update, getter, unregister} = reg.current

  useEffect(() => {
    return () => unregister()
  }, [])

  // 直列のため同じregisterを使う
  const curRegister: OptionRegister = useCallback(() => {
    return {update, getter, unregister: () => {}}
  }, [])

  return (
    <ClipSequence>
      {ast.children.map(child => {
        switch (child.type) {
          case PsdElm.DeclareVariable:
            return <DeclareVariableRuntime
              ast={child}
              variables={variables}
              initializingVariables={{}}
              register={curRegister}
            />
          case PsdElm.MotionClip:
            return <MotionClipRuntime
              ast={child}
              variables={variables}
              register={curRegister}
            />
          case PsdElm.Voice:
            return <VoiceRuntime
              ast={child}
              variables={variables}
              register={curRegister}
            />
          case PsdElm.Motion:
            return <MotionRuntime
              ast={child}
              variables={variables}
              register={curRegister}
            />
          default:
            return null
        }
      }).map((child, i) => <Clip key={i}> {child} </Clip>)}
    </ClipSequence>
  )
}

type DeclareVariableRuntimeProps = {
  ast: DeclareVariableNode
  variables: Record<string, Variable<any>>
  initializingVariables: Record<string, Variable<any>>
  register: OptionRegister
}

const DeclareVariableRuntime = ({
  ast,
  variables,
  initializingVariables,
  register
}: DeclareVariableRuntimeProps) => {
  // T extends VariableTypeとして
  // DeclareVariableで受け取る型がTなので
  // ast.initValue: T
  // であり、これを使う限り問題ない
  const variable = useVariable(ast.initValue)
  const newInitVariables = {[ast.variableName]: variable, ...initializingVariables}

  switch (ast.children.type) {
    case PsdElm.DeclareVariable:
      return <DeclareVariableRuntime
        ast={ast.children}
        variables={variables}
        initializingVariables={newInitVariables}
        register={register}
      />
    case PsdElm.DeclareAnimation:
      return <DeclareAnimationRuntime
        ast={ast.children}
        variables={variables}
        initializingVariables={newInitVariables}
        register={register}
      />
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
  register
}: MotionClipRuntimeProps) => {
  const reg = useRef<ReturnType<OptionRegister>>(undefined)
  if (!reg.current) {
    reg.current = register()
  }
  const {update, getter: superGetter, unregister} = reg.current

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
      order.current = order.current.filter(x => x !== id)
      recompute()
    }

    const getter = () => {
      const index = order.current.indexOf(id)

      const prevIds = order.current.slice(0, index)

      const prevOptions = prevIds.map(i => curRegistry.current.get(i) ?? {})

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
            return <MotionSequenceRuntime
              key={i}
              ast={child}
              variables={variables}
              register={curRegister}
            />
          case PsdElm.DeclareVariable:
            return <DeclareVariableRuntime
              key={i}
              ast={child}
              variables={variables}
              initializingVariables={{}}
              register={curRegister}
            />
          case PsdElm.Voice:
            return <VoiceRuntime
              key={i}
              ast={child}
              variables={variables}
              register={curRegister}
            />
          case PsdElm.Motion:
            return <MotionRuntime
              key={i}
              ast={child}
              variables={variables}
              register={curRegister}
            />
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
  register
}: DeclareAnimationRuntimeProps) => {

  useAnimation(async (ctx) => {
    await ast.animation(ctx, initializingVariables)
  }, [])

  const curVariables = {...variables, ...initializingVariables}

  const reg = useRef<ReturnType<OptionRegister>>(undefined)
  if (!reg.current) {
    reg.current = register()
  }
  const {update, getter: superGetter, unregister} = reg.current

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
      order.current = order.current.filter(x => x !== id)
      recompute()
    }

    const getter = () => {
      const index = order.current.indexOf(id)

      const prevIds = order.current.slice(0, index)

      const prevOptions = prevIds.map(i => curRegistry.current.get(i) ?? {})

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
            return <MotionSequenceRuntime
              key={i}
              ast={child}
              variables={curVariables}
              register={curRegister}
            />
          case PsdElm.DeclareVariable:
            return <DeclareVariableRuntime
              key={i}
              ast={child}
              variables={curVariables}
              initializingVariables={{}}
              register={curRegister}
            />
          case PsdElm.Voice:
            return <VoiceRuntime
              key={i}
              ast={child}
              variables={curVariables}
              register={curRegister}
            />
          case PsdElm.Motion:
            return <MotionRuntime
              key={i}
              ast={child}
              variables={curVariables}
              register={curRegister}
            />
          default:
            return null
        }
      })}
    </>
  )
}

type VoiceRuntimeProps = {
  ast: VoiceNode,
  variables: Record<string, Variable<any>>
  register: OptionRegister
}

const VoiceRuntime = ({
  ast,
  variables,
  register
}: VoiceRuntimeProps) => {
  const reg = useRef<ReturnType<OptionRegister>>(undefined)
  if (!reg.current) {
      reg.current = register()
  }
  const { update, getter, unregister } = reg.current

  useEffect(() => {
    return () => unregister()
  }, [])

  const localFrame = useCurrentFrame()
  const globalFrame = useGlobalCurrentFrame()
  const frames = [localFrame, globalFrame]
  const audioSegments = useAudioSegments()
  const audioSegment = useMemo(() => {
    return audioSegments.filter(seg => seg.source.path == ast.voice).at(0)
  }, [ast, audioSegments])
  const waveformData = useWaveformBank([ast.voice])

  useEffect(() => {
    if (audioSegment && ast.voiceMotion) {
      update(ast.voiceMotion(audioSegment, waveformData.get(ast.voice) ?? null, variables, frames))
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
  ast: MotionNode,
  variables: Record<string, Variable<any>>
  register: OptionRegister
}

const MotionRuntime = ({
  ast,
  variables,
  register
}: MotionRuntimeProps) => {
  const reg = useRef<ReturnType<OptionRegister>>(undefined)
  if (!reg.current) {
      reg.current = register()
  }
  const { update, getter, unregister } = reg.current

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
  const cached = psdCache.get(psd.path)
  if (cached != null) return cached

  const pending = psdPending.get(psd.path)
  if (pending) return pending

  const next = (async () => {
    const res = await fetch(buildPsdUrl(psd))
    if (!res.ok) {
      throw new Error("failed to fetch psd file")
    }
  
    const file = readPsd(await res.arrayBuffer())
    psdCache.set(psd.path, file)
    return file
  })().finally(() => {
    psdPending.delete(psd.path)
  })

  psdPending.set(psd.path, next)
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
