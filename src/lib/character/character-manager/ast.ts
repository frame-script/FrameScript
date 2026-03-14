import type { CharacterChild } from "../character-unit/ast"

export const CharacterManagerElement = {
  CharacterManager: "CharacterManager",
  DeclareCharacters: "DeclareCharacters",
  Senario: "Senario",
  DeclareCharacter: "DeclareCharacter",
  Chapter: "Chapter",
  Speaker: "Speaker",
} as const

export type CharacterManagerChild =
  | DeclareCharactersNode
  | SenarioNode

export type DeclareCharactersChild =
  | DeclareCharacterNode

export type SenarioChild =
  | ChapterNode

export type DeclareCharaterChild = CharacterChild

export type ChapterChild = 
  | SpeakerNode

export type SpeakerChild = CharacterChild


/* =========================
   Nodes
========================= */

export interface CharacterManagerNode {
  type: typeof CharacterManagerElement.CharacterManager
  children: CharacterManagerChild[]
}

export interface DeclareCharactersNode {
  type: typeof CharacterManagerElement.DeclareCharacters
  children: DeclareCharactersChild[]
}

export interface SenarioNode {
  type: typeof CharacterManagerElement.Senario
  children: SenarioChild[]
}

export interface DeclareCharacterNode {
  type: typeof CharacterManagerElement.DeclareCharacter
  name: string
  psd: string
  children: DeclareCharaterChild[]
}

export interface ChapterNode {
  type: typeof CharacterManagerElement.Chapter
  children: ChapterChild[]
}

export interface SpeakerNode {
  type: typeof CharacterManagerElement.Speaker
  name: string
  children: SpeakerChild[]
}
