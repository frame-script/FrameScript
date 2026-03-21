import React, { isValidElement, type ReactElement, type ReactNode } from "react"
import type { BlockChild, BlockNode, CharacterChild, CharacterNode, DeclareAnimationChild, DeclareAnimationNode, DeclareVariableChild, DeclareVariableNode, MotionNode, MotionSequenceChild, MotionSequenceNode, VoiceChild, VoiceNode } from "./ast"
import { PsdCharacterElement as PsdElm } from "./ast"

type AnyElement = ReactElement<any, any>


export const parsePsdCharacter = (
  children: ReactNode,
): CharacterNode => {
  const body = parsePsdCharacterChildren(children)
  return {
    type: PsdElm.Character,
    children: body,
  }
}

const parsePsdCharacterChildren = (
  children: ReactNode,
): CharacterChild[] => {
  const result: CharacterChild[] = []

  React.Children.forEach(children, (child) => {
    if (!isValidElement(child)) return

    const type = getDslType(child)

    switch (type) {
      case PsdElm.MotionSequence:
        result.push(parseMotionSequence(child))
        break

      case PsdElm.DeclareVariable:
        result.push(parseDeclareVariable(child))
        break

      case PsdElm.Voice:
        result.push(parseVoice(child))
        break
      case PsdElm.Motion:
        result.push(parseMotion(child))
        break
      case "function":
        const expanded = child.type(child.props)
        const expandedAst = parsePsdCharacterChildren(expanded)
        result.push(...expandedAst)
        break

      default:
        throw new Error(`Invalid DSL type in root: ${type}`)
    }
  })

  return result
}

const parseMotionSequence = (
  self: AnyElement,
): MotionSequenceNode => {
  const { children } = self.props
  const body = parseMotionSequenceChildren(children)
  return {
    type: PsdElm.MotionSequence,
    children: body,
  }
}

const parseMotionSequenceChildren = (
  children: ReactNode,
): MotionSequenceChild[] => {
  const result: MotionSequenceChild[] = []

  React.Children.forEach(children, (child) => {
    if (!isValidElement(child)) return

    const type = getDslType(child)

    switch (type) {
      case PsdElm.Block:
        result.push(parseBlock(child))
        break

      case PsdElm.DeclareVariable:
        result.push(parseDeclareVariable(child))
        break

      case PsdElm.Voice:
        result.push(parseVoice(child))
        break
      case PsdElm.Motion:
        result.push(parseMotion(child))
        break
      case "function":
        const expanded = child.type(child.props)
        const expandedAst = parseMotionSequenceChildren(expanded)
        result.push(...expandedAst)
        break

      default:
        throw new Error(`Invalid DSL type in ${PsdElm.MotionSequence}: ${type}`)
    }
  })

  return result
}

const parseDeclareVariable = (
  self: AnyElement,
): DeclareVariableNode => {
  const { variableName, initValue, children } = self.props
  const body = parseDeclareVariableChild(children)

  return {
    type: PsdElm.DeclareVariable,
    variableName,
    initValue,
    children: body,
  }
}


const parseDeclareVariableChild = (
  children: ReactNode,
): DeclareVariableChild => {

  const single = React.Children.toArray(children)
  if (single.length == 1) {
    const child = single[0]

    if (!isValidElement(child)) {
      throw new Error(`Invalid Element in ${PsdElm.DeclareVariable}`)
    }

    const type = getDslType(child)


    switch (type) {
      case PsdElm.DeclareVariable:
        return parseDeclareVariable(child)

      case PsdElm.DeclareAnimation:
        return parseDeclareAnimation(child)
      case "function":
        const expanded = child.type(child.props)
        const expandedAst = parseDeclareVariable(expanded)
        return expandedAst

      default:
        throw new Error(`Invalid DSL type in ${PsdElm.DeclareVariable}: ${type}`)
    }
  } else {
    throw new Error(`${PsdElm.DeclareVariable} take just one element`)
  }
}

const parseBlock = (
  self: AnyElement,
): BlockNode => {
  const { children } = self.props
  const body = parseBlockChildren(children)
  return {
    type: PsdElm.Block,
    children: body,
  }
}

const parseBlockChildren = (
  children: ReactNode,
): BlockChild[] => {
  const result: BlockChild[] = []

  React.Children.forEach(children, (child) => {
    if (!isValidElement(child)) return

    const type = getDslType(child)

    switch (type) {
      case PsdElm.MotionSequence:
        result.push(parseMotionSequence(child))
        break

      case PsdElm.DeclareVariable:
        result.push(parseDeclareVariable(child))
        break

      case PsdElm.Voice:
        result.push(parseVoice(child))
        break
      case PsdElm.Motion:
        result.push(parseMotion(child))
        break
      case "function":
        const expanded = child.type(child.props)
        const expandedAst = parseBlockChildren(expanded)
        result.push(...expandedAst)
        break

      default:
        throw new Error(`Invalid DSL type in ${PsdElm.Block}: ${type}`)
    }
  })

  return result
}

const parseDeclareAnimation = (
  self: AnyElement,
): DeclareAnimationNode => {
  const { animation, children } = self.props
  const body = parseDeclareAnimationChildren(children)
  return {
    type: PsdElm.DeclareAnimation,
    animation: animation,
    children: body,
  }
}

const parseDeclareAnimationChildren = (
  children: ReactNode,
): DeclareAnimationChild[] => {
  const result: DeclareAnimationChild[] = []

  React.Children.forEach(children, (child) => {
    if (!isValidElement(child)) return

    const type = getDslType(child)

    switch (type) {
      case PsdElm.MotionSequence:
        result.push(parseMotionSequence(child))
        break

      case PsdElm.DeclareVariable:
        result.push(parseDeclareVariable(child))
        break

      case PsdElm.Voice:
        result.push(parseVoice(child))
        break
      case PsdElm.Motion:
        result.push(parseMotion(child))
        break
      case "function":
        const expanded = child.type(child.props)
        const expandedAst = parseDeclareAnimationChildren(expanded)
        result.push(...expandedAst)
        break

      default:
        throw new Error(`Invalid DSL type in ${PsdElm.DeclareAnimation}: ${type}`)
    }
  })

  return result
}

const parseVoice = (
  self: AnyElement,
): VoiceNode => {
  const { voice, trim, fadeInFrames, fadeOutFrames, volume, showWaveform, children } = self.props
  const body = parseVoiceChildren(children)
  return {
    type: PsdElm.Voice,
    voice,
    trim,
    fadeInFrames,
    fadeOutFrames,
    volume: volume ?? undefined,
    showWaveform,
    children: body,
  }
}

const parseVoiceChildren = (
  children: ReactNode,
): VoiceChild[] => {
  const result: VoiceChild[] = []

  React.Children.forEach(children, (child) => {
    if (!isValidElement(child)) return

    const type = getDslType(child)

    switch (type) {
      case PsdElm.Motion:
        result.push(parseMotion(child))
        break
      case "function":
        const expanded = child.type(child.props)
        const expandedAst = parseVoiceChildren(expanded)
        result.push(...expandedAst)
        break

      default:
        throw new Error(`Invalid DSL type in ${PsdElm.Voice}: ${type}`)
    }
  })

  return result
}

const parseMotion = (
  self: AnyElement,
): MotionNode => {
  const { motion } = self.props
  return {
    type: PsdElm.Motion,
    motion
  }
}


const getDslType = (el: AnyElement): string | undefined => {
  const type = el.type as any

  if (type?.__dslType) {
    return type.__dslType
  }
  if (typeof type === "function") {
    return "function"
  }

  return undefined
}
