import type { Variable } from "../../animation"
import type { Trim } from "../../trim"
import { defineDSL } from "../utils/defineDSL"
import { PsdCharacterElement } from "./ast"

// 要素を直列化する
export const MotionSequence = defineDSL<{
  children: React.ReactNode
}>(PsdCharacterElement.MotionSequence)

// Variableを宣言する
type DeclareVariableProps<T extends string> = {
  variableName: T
  initValue: any
  children: React.ReactNode
}

export const DeclareVariable = <T extends string = string>(_: DeclareVariableProps<T>) => null

DeclareVariable.__dslType = PsdCharacterElement.DeclareVariable

// MotionSequence直下で使用し、Block内を並列化する
export const Block = defineDSL<{
  children: React.ReactNode
}>(PsdCharacterElement.Block)

// 宣言されたVariableをアニメーションとして登録する
type DeclareAnimationProps<T extends string> = {
  f: (ctx: any, variable: Record<T, Variable<any>>) => Promise<void>
  children: React.ReactNode
}
export const DeclareAnimation = <T extends string = string>(_: DeclareAnimationProps<T>) => null
DeclareAnimation.__dslType = PsdCharacterElement.DeclareAnimation

// 音声を配置する（ファイルのみ）
export const Voice = defineDSL<{
  voice: string
  trim?: Trim
  fadeInFrames?: number
  fadeOutFrames?: number
  volume?: number
  showWaveform?: boolean
  children?: React.ReactNode
}>(PsdCharacterElement.Voice)

// psdファイルのオプションを制御し、動きをつける
// frames[0]: useCurrentFrame
// frames[frames.length - 1]: useGlobalCurrentFrame
type MotionProps<T extends string> = {
  motion: (variables: Record<T, Variable<any>>, frames: number[]) => Record<string, any>
}
export const Motion = <T extends string = string>(_: MotionProps<T>) => null
Motion.__dslType = PsdCharacterElement.Motion

// complex components ------------------------

type MotionWithVarsProps<S extends string, T extends string> = {
  variables: Record<T, any>
  animation: (ctx: any, variable: Record<T, Variable<any>>) => Promise<void>
  motion: (variables: Record<S | T, Variable<any>>, frames: number[]) => Record<string, any>
}

type Entries<T> = [keyof T, T[keyof T]][];

export const MotionWithVars = <S extends string = never, T extends string = string>(props: MotionWithVarsProps<S, T>) => {
  let result =
    <DeclareAnimation f={props.animation}>
      <Motion motion={props.motion} />
    </DeclareAnimation>

  for (const [key, value] of Object.entries(props.variables).reverse() as Entries<typeof props.variables>) {
    result =
      <DeclareVariable variableName={key} initValue={value}>
        {result}
      </DeclareVariable>
  }

  return result
}
