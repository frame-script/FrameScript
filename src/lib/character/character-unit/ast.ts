import type { AnimationContext, Variable, VariableType } from "../../animation"
import type { AudioSegment } from "../../audio-plan"
import type { WaveformData } from "../../audio-waveform"
import type { Trim } from "../../trim"

export const PsdCharacterElement = {
  Character: "Character",
  MotionSequence: "MotionSequence",
  DeclareVariable: "DeclareVariable",
  MotionClip: "MotionClip",
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
  | MotionClipNode
  | DeclareVariableNode
  | VoiceNode
  | MotionNode

export type DeclareVariableChild = DeclareVariableNode | DeclareAnimationNode

export type MotionClipChild =
  | MotionSequenceNode
  | DeclareVariableNode
  | VoiceNode
  | MotionNode

export type DeclareAnimationChild =
  | MotionSequenceNode
  | DeclareVariableNode
  | VoiceNode
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

export interface MotionClipNode {
  type: typeof PsdCharacterElement.MotionClip
  children: MotionClipChild[]
}

export interface DeclareAnimationNode {
  type: typeof PsdCharacterElement.DeclareAnimation
  animation: (
    ctx: AnimationContext,
    variable: Record<string, Variable<VariableType>>,
  ) => Promise<void>
  children: DeclareAnimationChild[]
}

export interface VoiceNode {
  type: typeof PsdCharacterElement.Voice
  voice: string
  voiceMotion?: (
    segment: AudioSegment,
    waveform: WaveformData | null,
    variables: Record<string, Variable<VariableType>>,
    frames: number[],
  ) => Record<string, any>
  trim?: Trim
  fadeInFrames?: number
  fadeOutFrames?: number
  volume:
    | undefined
    | number
    | ((
        variables: Record<string, Variable<VariableType>>,
        frames: number[],
      ) => number)
  showWaveform?: boolean
}

export interface MotionNode {
  type: typeof PsdCharacterElement.Motion
  motion: (
    variables: Record<string, Variable<VariableType>>,
    frames: number[],
  ) => Record<string, any>
}
