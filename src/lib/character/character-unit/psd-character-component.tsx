import type { ReactNode } from "react"
import type { Variable, VariableType, AnimationContext } from "../../animation"
import type { Trim } from "../../trim"
import { defineDSL } from "../utils/defineDSL"
import { PsdCharacterElement } from "./ast"
import type { AudioSegment } from "../../audio-plan"
import type { WaveformData } from "../../audio-waveform"
import type { Entries, TypedRecord, Variables } from "../utils/util-types"

/**
 * Serialize children elements in sequence.
 * Behaves similarly to a Sequence component.
 *
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
 * Declare a Variable.
 * @template T Union of string literal variable names
 * @template U Variable type (one of VariableType)
 * @param variableName Name of the variable
 * @param initValue Initial value of the variable (used in useVariable)
 *
 * Variableを宣言する。
 * @template T 変数名の文字列リテラルのUnion
 * @template U 変数の型。VariableTypeの一つ
 * @param variableName 変数名
 * @param initValue 変数の初期値。useVariableで指定するもの
 */
export const DeclareVariable = <
  T extends string = string,
  U extends VariableType = VariableType,
>(
  _: DeclareVariableProps<T, U>,
) => null

DeclareVariable.__dslType = PsdCharacterElement.DeclareVariable

/**
 * Used directly under MotionSequence to parallelize children elements.
 *
 * MotionSequence直下で使用し、子要素を並列化する
 */
export const MotionClip = defineDSL<{
  children: React.ReactNode
}>(PsdCharacterElement.MotionClip)

type DeclareAnimationProps<T extends string> = {
  animation: (
    ctx: AnimationContext,
    variables: Record<T, Variable<VariableType>>,
  ) => Promise<void>
  children: React.ReactNode
}

/**
 * Register declared variables as an animation.
 * @template T Union of variable names to initialize
 * @param animation Function that receives AnimationContext and variable record, same as useAnimation callback
 *
 * 宣言されたVariableをアニメーションとして登録する
 * @template T 初期化する変数の変数名リテラルのUnion
 * @param animation AnimationContextと変数のRecordを受け取ってアニメーションを記述する。useAnimationの第一引数と同じ
 */
export const DeclareAnimation = <T extends string = string>(
  _: DeclareAnimationProps<T>,
) => null
DeclareAnimation.__dslType = PsdCharacterElement.DeclareAnimation

/**
 * Place audio (file-based). Same as Sound except for voice.
 * @param voice Audio file path
 * @param voiceMotion Function to generate animation using audio
 *
 * 音声を配置する（ファイルのみ）。voice以外はSoundと同様
 * @param voice 音声ファイル
 * @param voiceMotion 音声を利用したアニメーションをつける関数
 */
export const Voice = defineDSL<{
  voice: string
  voiceMotion?: (
    segment: AudioSegment,
    waveform: WaveformData,
    variables: Record<string, Variable<VariableType>>,
    frames: number[],
  ) => Record<string, any>
  trim?: Trim
  fadeInFrames?: number
  fadeOutFrames?: number
  volume?: number
  showWaveform?: boolean
}>(PsdCharacterElement.Voice)

type MotionProps<T extends string> = {
  motion: (
    variables: Record<T, Variable<VariableType>>,
    frames: number[],
  ) => Record<string, any>
}

/**
 * Control PSD options and apply motion.
 * Hooks cannot be used, so values must be retrieved via frame indices (e.g., variable.name.get(frames[0])).
 * @template T Union of variable names used
 * @param motion Function that returns PSD option record from variables and frames
 *
 * frames behavior:
 * frames[0] -> useCurrentFrame
 * frames[last] -> useGlobalCurrentFrame
 *
 * psdファイルのオプションを制御し、動きをつける
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

/**
 * Convert flat variable record into strongly typed Variables<T>.
 *
 * フラットな変数Recordを型付きVariables<T>に変換する
 */
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
 * Declare multiple variables and register animation at once.
 * @template T Type of declared variables
 * @param variables Object-style variable declaration (e.g., {t: 0, p: {x: 0, y: 0}})
 * @param animation Animation registration callback (same as useAnimation)
 *
 * 変数を宣言する。
 * animationの登録も同時に行う。
 * @template T 宣言する変数の型
 * @param variables 変数をオブジェクトとして宣言する。e.g. variables: {t: 0, p: {x: 0, y: 0}}
 * @param animation AnimationContextと宣言した変数を受け取って、アニメーションを登録する。useAnimationのコールバックと同様。
 */
export const DeclareVariables = <T extends Record<string, VariableType> = any>(
  props: DeclareVariablesProps<T>,
) => {
  let result = (
    <DeclareAnimation
      animation={(ctx, variables) =>
        props.animation(ctx, typeVariables<T>(variables))
      }
    >
      {props.children}
    </DeclareAnimation>
  )

  // Wrap children with DeclareVariable in reverse order (outermost = first variable)
  // 逆順でDeclareVariableをネストしてラップする（最初の変数が最外側になる）
  for (const [key, value] of Object.entries(
    props.variables,
  ).reverse() as Entries<typeof props.variables>) {
    result = (
      <DeclareVariable variableName={key as string} initValue={value}>
        {result}
      </DeclareVariable>
    )
  }

  return result
}

type MotionWithVarsProps<
  S extends Record<string, VariableType>,
  T extends Record<string, VariableType>,
> = {
  variables: TypedRecord<T>
  animation: (ctx: AnimationContext, variable: Variables<T>) => Promise<void>
  motion: (variables: Variables<S & T>, frames: number[]) => Record<string, any>
}

type VoiceMotionProps<T extends Record<string, VariableType>> = {
  voice: string
  voiceMotion: (
    segment: AudioSegment,
    waveform: WaveformData,
    variables: Variables<T>,
    frames: number[],
  ) => Record<string, any>
  trim?: Trim
  fadeInFrames?: number
  fadeOutFrames?: number
  volume?: number
  showWaveform?: boolean
}

/**
 * Perform animation driven by audio.
 * Same as Voice.voiceMotion but with typed variables.
 * @template T Variable types to declare
 *
 * 音声を利用したアニメーションを行う
 * VoiceのvoiceMotionと同様だがvariablesに型をつけられる
 * @template T 宣言する変数の型
 */
export const VoiceMotion = <T extends Record<string, VariableType> = any>(
  props: VoiceMotionProps<T>,
) => {
  let result = (
    <Voice
      voice={props.voice}
      voiceMotion={(
        segment: AudioSegment,
        waveform: WaveformData,
        variables: Record<string, Variable<VariableType>>,
        frames: number[],
      ) =>
        props.voiceMotion(segment, waveform, typeVariables(variables), frames)
      }
      trim={props.trim}
      fadeInFrames={props.fadeInFrames}
      fadeOutFrames={props.fadeOutFrames}
      volume={props.volume}
      showWaveform={props.showWaveform}
    />
  )

  return result
}

/**
 * Create Motion using variables.
 * Handles variable declaration, animation registration, and motion definition.
 * @template S Already registered variable types
 * @template T Newly declared variable types
 * @param variables Variable declaration object
 * @param animation Animation registration callback
 * @param motion Motion definition using variables and frames
 *
 * 変数を利用したMotionをつくる。
 * 変数の宣言、アニメーションの登録、動きの実装を行う。
 * @template S 既にアニメーションとして登録済みの変数の型
 * @template T 宣言する変数の型
 * @param variables 変数をオブジェクトとして宣言する。e.g. variables: {t: 0, p: {x: 0, y: 0}}
 * @param animation AnimationContextと宣言した変数を受け取って、アニメーションを登録する。useAnimationのコールバックと同様。
 * @param motion variablesとframesを受け取って、psdのオプションのRecordを返す。フックは使えないのでvariables.t.get(frames[0])のようにして変数を利用する。
 */
export const MotionWithVars = <
  S extends Record<string, VariableType> = {},
  T extends Record<string, VariableType> = Record<string, any>,
>(
  props: MotionWithVarsProps<S, T>,
) => {
  let result = (
    <DeclareAnimation
      animation={(ctx, variables) =>
        props.animation(ctx, typeVariables<T>(variables))
      }
    >
      <Motion
        motion={(variables, frames) =>
          props.motion(typeVariables<S & T>(variables), frames)
        }
      />
    </DeclareAnimation>
  )

  // Wrap with DeclareVariable in reverse order
  // DeclareVariableで逆順にラップする
  for (const [key, value] of Object.entries(
    props.variables,
  ).reverse() as Entries<typeof props.variables>) {
    result = (
      <DeclareVariable variableName={key as string} initValue={value}>
        {result}
      </DeclareVariable>
    )
  }

  return result
}
