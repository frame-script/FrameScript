import React, { isValidElement, type ReactElement, type ReactNode } from "react"
import type {
  MotionClipChild,
  MotionClipNode,
  CharacterChild,
  CharacterNode,
  DeclareAnimationChild,
  DeclareAnimationNode,
  DeclareVariableChild,
  DeclareVariableNode,
  MotionNode,
  MotionSequenceChild,
  MotionSequenceNode,
  VoiceNode,
} from "./ast"
import { PsdCharacterElement as PsdElm } from "./ast"

type AnyElement = ReactElement<any, any>

const expandDslFunction = (child: AnyElement): ReactNode => {
  const component = child.type as (props: Record<string, unknown>) => ReactNode
  return component(child.props)
}

const expandDslElement = (child: AnyElement): AnyElement => {
  const expanded = expandDslFunction(child)
  if (!isValidElement(expanded)) {
    throw new Error("Expanded DSL component must return a single React element")
  }
  return expanded
}

export const parsePsdCharacter = (children: ReactNode): CharacterNode => {
  const body = parsePsdCharacterChildren(children)
  return {
    type: PsdElm.Character,
    children: body,
  }
}

const parsePsdCharacterChildren = (children: ReactNode): CharacterChild[] => {
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
        const expanded = expandDslFunction(child)
        const expandedAst = parsePsdCharacterChildren(expanded)
        result.push(...expandedAst)
        break

      default:
        throw new Error(`Invalid DSL type in root: ${type}`)
    }
  })

  return result
}

const parseMotionSequence = (self: AnyElement): MotionSequenceNode => {
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
      case PsdElm.MotionClip:
        result.push(parseMotionClip(child))
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
        const expanded = expandDslFunction(child)
        const expandedAst = parseMotionSequenceChildren(expanded)
        result.push(...expandedAst)
        break

      default:
        throw new Error(`Invalid DSL type in ${PsdElm.MotionSequence}: ${type}`)
    }
  })

  return result
}

const parseDeclareVariable = (self: AnyElement): DeclareVariableNode => {
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
        const expanded = expandDslElement(child)
        const expandedAst = parseDeclareVariable(expanded)
        return expandedAst

      default:
        throw new Error(
          `Invalid DSL type in ${PsdElm.DeclareVariable}: ${type}`,
        )
    }
  } else {
    throw new Error(`${PsdElm.DeclareVariable} take just one element`)
  }
}

const parseMotionClip = (self: AnyElement): MotionClipNode => {
  const { children } = self.props
  const body = parseMotionClipChildren(children)
  return {
    type: PsdElm.MotionClip,
    children: body,
  }
}

const parseMotionClipChildren = (children: ReactNode): MotionClipChild[] => {
  const result: MotionClipChild[] = []

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
        const expanded = expandDslFunction(child)
        const expandedAst = parseMotionClipChildren(expanded)
        result.push(...expandedAst)
        break

      default:
        throw new Error(`Invalid DSL type in ${PsdElm.MotionClip}: ${type}`)
    }
  })

  return result
}

const parseDeclareAnimation = (self: AnyElement): DeclareAnimationNode => {
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
        const expanded = expandDslFunction(child)
        const expandedAst = parseDeclareAnimationChildren(expanded)
        result.push(...expandedAst)
        break

      default:
        throw new Error(
          `Invalid DSL type in ${PsdElm.DeclareAnimation}: ${type}`,
        )
    }
  })

  return result
}

const parseVoice = (self: AnyElement): VoiceNode => {
  const {
    voice,
    voiceMotion,
    trim,
    fadeInFrames,
    fadeOutFrames,
    volume,
    showWaveform,
  } = self.props
  return {
    type: PsdElm.Voice,
    voice,
    voiceMotion,
    trim,
    fadeInFrames,
    fadeOutFrames,
    volume: volume ?? undefined,
    showWaveform,
  }
}

const parseMotion = (self: AnyElement): MotionNode => {
  const { motion } = self.props
  return {
    type: PsdElm.Motion,
    motion,
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
