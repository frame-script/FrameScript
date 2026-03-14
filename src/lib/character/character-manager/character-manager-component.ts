import { defineDSL } from "../utils/defineDSL"
import { CharacterManagerElement } from "./ast"

export const DeclareCharacters = defineDSL<{
  children: React.ReactNode
}>(CharacterManagerElement.DeclareCharacters)

export const Senario = defineDSL<{
  children: React.ReactNode
}>(CharacterManagerElement.Senario)

export const DeclareCharacter = defineDSL<{
  name: string
  psd: string
  children: React.ReactNode
}>(CharacterManagerElement.DeclareCharacter)

export const Chapter = defineDSL<{
  children: React.ReactNode
}>(CharacterManagerElement.Chapter)

export const Speaker = defineDSL<{
  name: string
  children: React.ReactNode
}>(CharacterManagerElement.Speaker)
