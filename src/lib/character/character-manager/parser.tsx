import React, { isValidElement, type ReactElement, type ReactNode } from "react"
import type {
  CharacterManagerNode,
  DeclareCharactersNode,
  ScenarioNode,
  DeclareCharacterNode,
  ChapterNode,
  SpeakerNode,
  ChapterChild,
} from "./ast"
import { CharacterManagerElement as ManagerElm } from "./ast"
import { Motion } from "../character-unit"

type AnyElement = ReactElement<any, any>

export const parseCharacterManager = (
  children: ReactNode,
): CharacterManagerNode => {
  const childrenArray = React.Children.toArray(children)
  if (childrenArray.length != 2) {
    throw "CharacterManager need DeclareCharacters and Scenario."
  }

  if (!isValidElement(childrenArray[0]) || !isValidElement(childrenArray[1])) {
    throw new Error(`Invalid Element in ${ManagerElm.CharacterManager}`)
  }

  const characters = parseDeclareCharacters(childrenArray[0])
  const scenario = parseScenario(childrenArray[1])

  return {
    type: ManagerElm.CharacterManager,
    characters: characters,
    scenario: scenario,
  }
}

const parseDeclareCharacters = (self: AnyElement): DeclareCharactersNode => {
  const { children } = self.props
  const body = parseDeclareCharactersChildren(children)
  return {
    type: ManagerElm.DeclareCharacters,
    children: body,
  }
}

const parseDeclareCharactersChildren = (
  children: ReactNode,
): DeclareCharacterNode[] => {
  return (
    React.Children.map(children, (child) => {
      if (!isValidElement(child)) return

      const type = getDslType(child)
      if (type == ManagerElm.DeclareCharacter) {
        return parseDeclareCharacter(child)
      } else {
        throw `Invalid DSL type in ${ManagerElm.DeclareCharacters}: ${type}`
      }
    }) ?? []
  )
}

const parseScenario = (self: AnyElement): ScenarioNode => {
  const { children } = self.props
  const body = parseScenarioChildren(children)
  return {
    type: ManagerElm.Scenario,
    children: body,
  }
}

const parseScenarioChildren = (children: ReactNode): ChapterNode[] => {
  return (
    React.Children.map(children, (child) => {
      if (!isValidElement(child)) return

      const type = getDslType(child)
      if (type == ManagerElm.Chapter) {
        return parseChapter(child)
      } else {
        throw `Invalid DSL type in ${ManagerElm.DeclareCharacters}: ${type}`
      }
    }) ?? []
  )
}

const parseDeclareCharacter = (self: AnyElement): DeclareCharacterNode => {
  const { name, psd, idleClassName, speakingClassName, children } = self.props
  let comp_child = (
    <Motion
      motion={(_v, _f) => {
        return {}
      }}
    />
  )
  if (children) {
    comp_child = children
  }
  return {
    type: ManagerElm.DeclareCharacter,
    name,
    psd,
    idleClassName,
    speakingClassName,
    children: comp_child,
  }
}

const parseChapter = (self: AnyElement): ChapterNode => {
  const { children } = self.props
  const body = parseChapterChildren(children)
  return {
    type: ManagerElm.Chapter,
    children: body,
  }
}

const parseChapterChildren = (children: ReactNode): ChapterChild[] => {
  return (
    React.Children.map(children, (child) => {
      if (!isValidElement(child)) return

      const type = getDslType(child)
      if (type == ManagerElm.Speaker) {
        return { kind: "speaker", node: parseSpeaker(child) }
      } else {
        return { kind: "other", node: child }
      }
    }) ?? []
  )
}

const parseSpeaker = (self: AnyElement): SpeakerNode => {
  const { className, name, children } = self.props
  return {
    type: ManagerElm.Speaker,
    className,
    name,
    children,
  }
}

const getDslType = (el: AnyElement): string | undefined => {
  const type = el.type as any

  if (type?.__dslType) {
    return type.__dslType
  }

  return undefined
}
