import type { Variable } from "../animation"
import { defineDSL } from "./defineDSL"
import { PsdCharacterElement } from "./ast"

// 要素を直列化する
export const MotionSequence = defineDSL<{
  children: React.ReactNode
}>(PsdCharacterElement.MotionSequence)

// Variableを宣言する
export const DeclareVariable = defineDSL<{
  variableName: string
  initValue: any
  children: React.ReactNode
}>(PsdCharacterElement.DeclareVariable)

// MotionSequence直下で使用し、Block内を並列化する
export const Block = defineDSL<{
  children: React.ReactNode
}>(PsdCharacterElement.Block)

// 宣言されたVariableをアニメーションとして登録する
export const DeclareAnimation = defineDSL<{
  f: (ctx: any, variable: Record<string, Variable<any>>) => Promise<void>
  children: React.ReactNode
}>(PsdCharacterElement.DeclareAnimation)

// 音声を配置する（ファイルのみ）
export const Voice = defineDSL<{
  voice: string
  volume?: number
  children?: React.ReactNode
}>(PsdCharacterElement.Voice)

// psdファイルのオプションを制御し、動きをつける
// frames[0]: useCurrentFrame
// frames[frames.length - 1]: useGlobalCurrentFrame
export const Motion = defineDSL<{
  motion: (variables: Record<string, Variable<any>>, frames: number[]) => Record<string, any>
}>(PsdCharacterElement.Motion)
