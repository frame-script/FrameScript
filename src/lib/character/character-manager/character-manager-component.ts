import type { ReactElement } from "react"
import { defineDSL } from "../utils/defineDSL"
import { CharacterManagerElement } from "./ast"
import type { OneOrMany } from "../utils/util-types"

type ChildrenOf<T> = OneOrMany<ReactElement<T>>

export const DeclareCharacters = defineDSL<{
  children: ChildrenOf<typeof DeclareCharacter>
}>(CharacterManagerElement.DeclareCharacters)

export const Senario = defineDSL<{
  children?: ChildrenOf<typeof Chapter>
}>(CharacterManagerElement.Senario)

export const DeclareCharacter = defineDSL<{
  className?: string
  name: string
  psd: string
  children: React.ReactNode
}>(CharacterManagerElement.DeclareCharacter)

export const Chapter = defineDSL<{
  children: React.ReactNode
}>(CharacterManagerElement.Chapter)

export const Speaker = defineDSL<{
  className?: string
  name: string
  children: React.ReactNode
}>(CharacterManagerElement.Speaker)
