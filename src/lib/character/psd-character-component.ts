import type { Variable } from "../animation"
import { defineDSL } from "./defineDSL"

export const MotionSequence = defineDSL<{
  children: React.ReactNode
}>("MotionSequence")

export const DeclareVariable = defineDSL<{
  variableName: string
  initValue: any
  children: React.ReactNode
}>("DeclareVariable")

export const Block = defineDSL<{
  children: React.ReactNode
}>("Block")

export const DeclareAnimation = defineDSL<{
  f: (ctx: any, variable: Record<string, Variable<any>>) => Promise<void>
  children?: React.ReactNode
}>("DeclareAnimation")

export const Voice = defineDSL<{
  voice: string
  volume?: number
  children?: React.ReactNode
}>("Voice")

export const Motion = defineDSL<{
  motion: (variables: Record<string, Variable<any>>, frames: number[]) => Record<string, any>
}>("Motion")
