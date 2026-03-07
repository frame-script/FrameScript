import type { Variable } from "../animation"

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
  type: "Character"
  children: CharacterChild[]
}

export interface MotionSequenceNode {
  type: "MotionSequence"
  children: MotionSequenceChild[]
}

export interface DeclareVariableNode {
  type: "DeclareVariable"
  variableName: string
  initValue: any
  children: DeclareVariableChild
}

export interface BlockNode {
  type: "Block"
  body: BlockChild[]
}

export interface DeclareAnimationNode {
  type: "Animation"
  f: (ctx: any, variable: Record<string, Variable<any>>) => Promise<void>
  body: DeclareAnimationChild[]
}

export interface VoiceNode {
  type: "Voice"
  voice: string
  children: VoiceChild[]
}

export interface MotionNode {
  type: "Motion"
  motion: (variables: Record<string, Variable<any>>, frames: number[]) => Record<string, any>
}

