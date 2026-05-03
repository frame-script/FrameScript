import type { ReactNode } from "react"

export const CharacterManagerElement = {
  CharacterManager: "CharacterManager",
  DeclareCharacters: "DeclareCharacters",
  Scenario: "Scenario",
  DeclareCharacter: "DeclareCharacter",
  Chapter: "Chapter",
  Speaker: "Speaker",
} as const

export type ChapterChild =
  | { kind: "speaker"; node: SpeakerNode }
  | { kind: "other"; node: ReactNode }

/* =========================
   Nodes
========================= */

export interface CharacterManagerNode {
  type: typeof CharacterManagerElement.CharacterManager
  characters: DeclareCharactersNode
  scenario: ScenarioNode
}

export interface DeclareCharactersNode {
  type: typeof CharacterManagerElement.DeclareCharacters
  children: DeclareCharacterNode[]
}

export interface ScenarioNode {
  type: typeof CharacterManagerElement.Scenario
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
