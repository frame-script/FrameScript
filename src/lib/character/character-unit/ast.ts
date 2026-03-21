import type { AnimationContext, Variable, VariableType } from "../../animation"
import type { Trim } from "../../trim"

export const PsdCharacterElement = {
  Character: "Character",
  MotionSequence: "MotionSequence",
  DeclareVariable: "DeclareVariable",
  Block: "Block",
  DeclareAnimation: "DeclareAnimation",
  Voice: "Voice",
  Motion: "Motion",
} as const


export type CharacterChild =
  | MotionSequenceNode
  | DeclareVariableNode
  | VoiceNode
  | MotionNode

export type MotionSequenceChild =
  | BlockNode
  | DeclareVariableNode
  | VoiceNode
  | MotionNode

export type DeclareVariableChild =
  | DeclareVariableNode
  | DeclareAnimationNode

export type BlockChild =
  | MotionSequenceNode
  | DeclareVariableNode
  | VoiceNode
  | MotionNode

export type DeclareAnimationChild =
  | MotionSequenceNode
  | DeclareVariableNode
  | VoiceNode
  | MotionNode

export type VoiceChild =
  | MotionNode




export interface CharacterNode {
  type: typeof PsdCharacterElement.Character
  children: CharacterChild[]
}

export interface MotionSequenceNode {
  type: typeof PsdCharacterElement.MotionSequence
  children: MotionSequenceChild[]
}

export interface DeclareVariableNode {
  type: typeof PsdCharacterElement.DeclareVariable
  variableName: string
  initValue: VariableType
  children: DeclareVariableChild
}

export interface BlockNode {
  type: typeof PsdCharacterElement.Block
  children: BlockChild[]
}

export interface DeclareAnimationNode {
  type: typeof PsdCharacterElement.DeclareAnimation
  animation: (ctx: AnimationContext, variable: Record<string, Variable<VariableType>>) => Promise<void>
  children: DeclareAnimationChild[]
}

export interface VoiceNode {
  type: typeof PsdCharacterElement.Voice
  voice: string
  trim?: Trim
  fadeInFrames?: number
  fadeOutFrames?: number
  volume: undefined | number | ((variables: Record<string, Variable<VariableType>>, frames: number[]) => number)
  showWaveform?: boolean
  children: VoiceChild[]
}

export interface MotionNode {
  type: typeof PsdCharacterElement.Motion
  motion: (variables: Record<string, Variable<VariableType>>, frames: number[]) => Record<string, any>
}

