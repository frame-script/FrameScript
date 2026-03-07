import type { Variable } from "../animation"
import { defineDSL } from "./defineDSL"

export const PsdCharacterElement = {
    MotionSequence: "MotionSequence",
    DeclareVariable: "DeclareVariable",
    Block: "Block",
    DeclareAnimation: "DeclareAnimation",
    Voice: "Voice",
    Motion: "Motion",
}

export const MotionSequence = defineDSL<{
  children: React.ReactNode
}>(PsdCharacterElement.MotionSequence)

export const DeclareVariable = defineDSL<{
  variableName: string
  initValue: any
  children: React.ReactNode
}>(PsdCharacterElement.DeclareVariable)

export const Block = defineDSL<{
  children: React.ReactNode
}>(PsdCharacterElement.Block)

export const DeclareAnimation = defineDSL<{
  f: (ctx: any, variable: Record<string, Variable<any>>) => Promise<void>
  children?: React.ReactNode
}>(PsdCharacterElement.DeclareAnimation)

export const Voice = defineDSL<{
  voice: string
  volume?: number
  children?: React.ReactNode
}>(PsdCharacterElement.Voice)

export const Motion = defineDSL<{
  motion: (variables: Record<string, Variable<any>>, frames: number[]) => Record<string, any>
}>(PsdCharacterElement.Motion)
