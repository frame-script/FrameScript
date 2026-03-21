import type { ReactNode } from "react"
import type { Variable, VariableType, AnimationContext } from "../../animation"
import type { Trim } from "../../trim"
import { defineDSL } from "../utils/defineDSL"
import { PsdCharacterElement } from "./ast"

// 要素を直列化する
export const MotionSequence = defineDSL<{
  children: React.ReactNode
}>(PsdCharacterElement.MotionSequence)

// Variableを宣言する
type DeclareVariableProps<T extends string, U extends VariableType> = {
  variableName: T
  initValue: U
  children: React.ReactNode
}

export const DeclareVariable = <T extends string = string, U extends VariableType = VariableType>(_: DeclareVariableProps<T, U>) => null

DeclareVariable.__dslType = PsdCharacterElement.DeclareVariable

// MotionSequence直下で使用し、Block内を並列化する
export const Block = defineDSL<{
  children: React.ReactNode
}>(PsdCharacterElement.Block)

// 宣言されたVariableをアニメーションとして登録する
type DeclareAnimationProps<T extends string> = {
  animation: (ctx: AnimationContext, variable: Record<T, Variable<VariableType>>) => Promise<void>
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
  motion: (variables: Record<T, Variable<VariableType>>, frames: number[]) => Record<string, any>
}
export const Motion = <T extends string = string>(_: MotionProps<T>) => null
Motion.__dslType = PsdCharacterElement.Motion

// complex components ------------------------

type Entries<T> = [keyof T, T[keyof T]][];

type TypedRecord<T extends Record<string, any>> = {
  [K in keyof T]: T[K]
}

type Variables<T extends Record<string, VariableType>> = {
  [K in keyof T]: Variable<T[K]>
}


function typeVariables<T extends Record<string, VariableType>>(
  flat: Record<string, Variable<VariableType>>,
): Variables<T> {
  const result = {} as Variables<T>

  for (const key of Object.keys(flat) as (keyof T)[]) {
    result[key] = flat[key as string] as Variable<T[typeof key]>
  }

  return result
}


type DeclareVariablesProps<T extends Record<string, VariableType>> = {
  variables: T
  animation: (ctx: AnimationContext, variable: Variables<T>) => Promise<void>
  children: ReactNode
}

export const DeclareVariables = <T extends Record<string, VariableType> = any>(props: DeclareVariablesProps<T>) => {
  let result =
    <DeclareAnimation animation={(ctx, variables) => props.animation(ctx, typeVariables<T>(variables))}>
        {props.children}
    </DeclareAnimation>

  for (const [key, value] of Object.entries(props.variables).reverse() as Entries<typeof props.variables>) {
    result =
      <DeclareVariable variableName={key as string} initValue={value}>
        {result}
      </DeclareVariable>
  }

  return result
}


type MotionWithVarsProps<S extends Record<string, VariableType>, T extends Record<string, VariableType>> = {
  variables: TypedRecord<T>
  animation: (ctx: AnimationContext, variable: Variables<T>) => Promise<void>
  motion: (variables: Variables<S & T>, frames: number[]) => Record<string, any>
}


export const MotionWithVars = <S extends Record<string, VariableType> = {}, T extends Record<string, VariableType> = Record<string, any>>(props: MotionWithVarsProps<S, T>) => {
  let result =
    <DeclareAnimation animation={(ctx, variables) => props.animation(ctx, typeVariables<T>(variables))}>
      <Motion motion={(variables, frames) => props.motion(typeVariables<S & T>(variables), frames)} />
    </DeclareAnimation>

  for (const [key, value] of Object.entries(props.variables).reverse() as Entries<typeof props.variables>) {
    result =
      <DeclareVariable variableName={key as string} initValue={value}>
        {result}
      </DeclareVariable>
  }

  return result
}
