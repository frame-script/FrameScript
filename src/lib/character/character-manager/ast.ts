import type { ReactNode } from "react"

export const CharacterManagerElement = {
  CharacterManager: "CharacterManager",
  DeclareCharacters: "DeclareCharacters",
  Senario: "Senario",
  DeclareCharacter: "DeclareCharacter",
  Chapter: "Chapter",
  Speaker: "Speaker",
} as const

export type ChapterChild = 
  | { kind: "speaker", node: SpeakerNode }
  | { kind: "other", node: ReactNode }


/* =========================
   Nodes
========================= */

export interface CharacterManagerNode {
  type: typeof CharacterManagerElement.CharacterManager
  characters: DeclareCharactersNode
  senario: SenarioNode
}

export interface DeclareCharactersNode {
  type: typeof CharacterManagerElement.DeclareCharacters
  children: DeclareCharacterNode[]
}

export interface SenarioNode {
  type: typeof CharacterManagerElement.Senario
  children: ChapterNode[]
}

export interface DeclareCharacterNode {
  type: typeof CharacterManagerElement.DeclareCharacter
  idleClassName?: string
  speakingClassName?: string
  name: string
  psd: string
  children: ReactNode
}

export interface ChapterNode {
  type: typeof CharacterManagerElement.Chapter
  children: ChapterChild[]
}

export interface SpeakerNode {
  type: typeof CharacterManagerElement.Speaker
  className?: string
  name: string
  children: ReactNode
}
