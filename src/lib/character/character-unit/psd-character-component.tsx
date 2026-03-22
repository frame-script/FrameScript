import type { ReactNode } from "react"
import type { Variable, VariableType, AnimationContext } from "../../animation"
import type { Trim } from "../../trim"
import { defineDSL } from "../utils/defineDSL"
import { PsdCharacterElement } from "./ast"
import type { AudioSegment } from "../../audio-plan"
import type { WaveformData } from "../../audio-waveform"

/**
 * 子要素を直列化する。
 * Sequenceと同等のはたらきをする。
 */
export const MotionSequence = defineDSL<{
  children: React.ReactNode
}>(PsdCharacterElement.MotionSequence)

type DeclareVariableProps<T extends string, U extends VariableType> = {
  variableName: T
  initValue: U
  children: React.ReactNode
}

/**
 * Variableを宣言する。
 * @template T 変数名の文字列リテラルのUnion
 * @template U 変数の型。VariableTypeの一つ
 * @param variableName 変数名
 * @param initValue 変数の初期値。useVariableで指定するもの
 */
export const DeclareVariable = <T extends string = string, U extends VariableType = VariableType>(_: DeclareVariableProps<T, U>) => null

DeclareVariable.__dslType = PsdCharacterElement.DeclareVariable

/**
 * MotionSequence直下で使用し、子要素を並列化する
 */
export const MotionClip = defineDSL<{
  children: React.ReactNode
}>(PsdCharacterElement.MotionClip)

type DeclareAnimationProps<T extends string> = {
  animation: (ctx: AnimationContext, variables: Record<T, Variable<VariableType>>) => Promise<void>
  children: React.ReactNode
}

/**
 * 宣言されたVariableをアニメーションとして登録する
 * @template T 初期化する変数の変数名リテラルのUnion
 * @param animation AnimationContextと変数のRecordを受け取ってアニメーションを記述する。useAnimationの第一引数と同じ
 */
export const DeclareAnimation = <T extends string = string>(_: DeclareAnimationProps<T>) => null
DeclareAnimation.__dslType = PsdCharacterElement.DeclareAnimation

/**
 * 音声を配置する（ファイルのみ）。voice以外はSoundと同様
 * @param voice 音声ファイル
 */
export const Voice = defineDSL<{
  voice: string
  voiceMotion?: (segment: AudioSegment, waveform: WaveformData, variables: Record<string, Variable<VariableType>>, frames: number[]) => Record<string, any>
  trim?: Trim
  fadeInFrames?: number
  fadeOutFrames?: number
  volume?: number
  showWaveform?: boolean
  children?: React.ReactNode
}>(PsdCharacterElement.Voice)

type MotionProps<T extends string> = {
  motion: (variables: Record<T, Variable<VariableType>>, frames: number[]) => Record<string, any>
}

/** psdファイルのオプションを制御し、動きをつける
 * フックは使えないのでvariable.name.get(frames[0])のようにフレームを指定して受け取る
 * @template T 使用する変数の変数名のリテラルのUnion
 * @param motion variablesとframesを受け取ってpsdオプションのRecordを返す
 *
 * motionの受け取るframesは次の通り
 * frames[0] useCurrentFrame
 * frames[frames.length - 1] useGlobalCurrentFrame
 */
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


const typeVariables = <T extends Record<string, VariableType>>(
  flat: Record<string, Variable<VariableType>>,
): Variables<T> => {
  const result = {} as Variables<T>

  for (const key of Object.keys(flat) as (keyof T)[]) {
    result[key] = flat[key as string] as Variable<T[typeof key]>
  }

  return result
}


type DeclareVariablesProps<T extends Record<string, VariableType>> = {
  variables: T
  animation: (ctx: AnimationContext, variables: Variables<T>) => Promise<void>
  children: ReactNode
}

/**
 * 変数を宣言する。
 * animationの登録も同時に行う。
 * @template T 宣言する変数の型
 * @param variables 変数をオブジェクトとして宣言する。e.g. variables: {t: 0, p: {x: 0, y: 0}}
 * @param animation AnimationContextと宣言した変数を受け取って、アニメーションを登録する。useAnimationのコールバックと同様。
 */
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


/**
 * 変数を利用したMotionをつくる。
 * 変数の宣言、アニメーションの登録、動きの実装を行う。
 * @template S 既にアニメーションとして登録済みの変数の型
 * @template T 宣言する変数の型
 * @param variables 変数をオブジェクトとして宣言する。e.g. variables: {t: 0, p: {x: 0, y: 0}}
 * @param animation AnimationContextと宣言した変数を受け取って、アニメーションを登録する。useAnimationのコールバックと同様。
 * @param motion variablesとframesを受け取って、psdのオプションのRecordを返す。フックは使えないのでvariables.t.get(frames[0])のようにして変数を利用する。
 */
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
