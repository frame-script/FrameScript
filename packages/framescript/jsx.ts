/**
 * JSX, without a virtual DOM.
 *
 * TSX is transpiled the classic way, into `React.createElement(type, props, ...children)`, which
 * this module defines as a global. That only makes a description; the description is turned into
 * nodes from the top down, so a component runs inside what its parents provided (a clip's frame,
 * for one) and runs once. Children that are functions are followed: their part of the parent's
 * children is made again when what they read changes, and a function that gives text only changes
 * the text.
 *
 * JSX は記述（ディスクリプタ）を作るだけで、上から順に一度だけ実体化される。
 * 関数の子・関数のスタイル値だけが変化に追従する。
 */

import * as cmd from "./internal/commands.ts"
import { bindStyle, type StyleProp } from "./style.ts"
import {
  type Accessor,
  type Context,
  createMemo,
  createRenderEffect,
  dispose,
  getOwner,
  onCleanup,
  Owner,
  runWithOwner,
  untrack,
  withContext,
} from "./reactive.ts"

const ELEMENT = Symbol.for("framescript.element")

export interface Element {
  readonly [ELEMENT]: true
  readonly type: string | Component<never>
  readonly props: Record<string, unknown>
}

/** Anything that can be a child. Functions are followed. */
export type JSXNode =
  | Element
  | string
  | number
  | boolean
  | null
  | undefined
  | (() => JSXNode)
  | JSXNode[]

// deno-lint-ignore no-explicit-any
export type Component<P = any> = (props: P) => JSXNode

export interface ElementProps {
  style?: StyleProp
  children?: JSXNode
  /** Called with the handle of the node once it is made. */
  ref?: (node: number) => void
}

/** `<img>`: a picture, in its box like the `img` of HTML. */
export interface ImageProps {
  /** A file of the project, or an absolute path. */
  src: MaybeAccessor<string>
  style?: StyleProp
  ref?: (node: number) => void
}

/**
 * `<video>`: a frame of a video, the one at `time`. This is the part that shows the frames; the
 * `Video` component works out the time from the clip it is in.
 */
export interface VideoElementProps {
  src: MaybeAccessor<string>
  /** Seconds into the video. NaN shows nothing. */
  time: MaybeAccessor<number>
  /** Whether it shows now. Otherwise it is about to, and starts decoding. */
  shown?: MaybeAccessor<boolean>
  style?: StyleProp
  ref?: (node: number) => void
}

export interface TextProps {
  style?: StyleProp
  /** Text, numbers, and functions that give them. */
  children?: JSXNode
  ref?: (node: number) => void
}

export function createElement(
  type: string | Component,
  props: Record<string, unknown> | null,
  ...children: JSXNode[]
): Element {
  const p: Record<string, unknown> = props ? { ...props } : {}
  if (children.length === 1) p.children = children[0]
  else if (children.length > 1) p.children = children
  return { [ELEMENT]: true, type, props: p }
}

export function Fragment(props: { children?: JSXNode }): JSXNode {
  return props.children
}

export function isElement(value: unknown): value is Element {
  return typeof value === "object" && value !== null && ELEMENT in value
}

// deno-lint-ignore no-explicit-any
;(globalThis as any).React = { createElement, Fragment }

// --- Making nodes --------------------------------------------------------------------------------

/** A run of a parent's children that may be replaced: what a function child made. */
class Slot {
  parts: Part[] = []
}

/** Either a node or a slot. */
type Part = number | Slot

/** A node whose children are parts. */
export class Host {
  parts: Part[] = []
  constructor(readonly node: number) {}

  /** Sends the children again, after a slot in them changed. */
  refresh(): void {
    const children: number[] = []
    const collect = (parts: Part[]) => {
      for (const p of parts) {
        if (typeof p === "number") children.push(p)
        else collect(p.parts)
      }
    }
    collect(this.parts)
    cmd.setChildren(this.node, children)
  }

  /** Makes `children` the content of the node. */
  mount(children: JSXNode): void {
    this.parts = instantiate(children, this)
    this.refresh()
  }
}

const MOUNT = Symbol("framescript.mount")

/** A child that makes its own parts: for what has to keep nodes across changes, like `For`. */
interface Mounter {
  readonly [MOUNT]: (host: Host) => Part[]
}

function mounter(mount: (host: Host) => Part[]): JSXNode {
  return { [MOUNT]: mount } as unknown as JSXNode
}

/**
 * A child that is one node, which `make` makes (with its children) when the child is made: for
 * components that make nodes of kinds JSX has no element for.
 */
export function nodeChild(make: () => number): JSXNode {
  return mounter(() => [make()])
}

/**
 * Makes `children` with `value` provided for `context`. A component that provides something
 * returns this: its children are only made after it returns, so providing in its body would be
 * too early.
 */
export function provide<T>(context: Context<T>, value: T, children: JSXNode): JSXNode {
  return mounter((host) => withContext(context, value, () => instantiate(children, host)))
}

/** Makes the nodes of `child` under the current owner. */
function instantiate(child: JSXNode, host: Host): Part[] {
  if (child === null || child === undefined || typeof child === "boolean") return []
  if (typeof child === "object" && MOUNT in child) return (child as unknown as Mounter)[MOUNT](host)
  if (Array.isArray(child)) return child.flatMap((c) => instantiate(c, host))
  if (typeof child === "string" || typeof child === "number") return [textNode(String(child))]
  if (typeof child === "function") return [follow(child, host)]
  if (isElement(child)) {
    const { type, props } = child
    if (typeof type === "function") {
      return instantiate(untrack(() => (type as Component)(props)), host)
    }
    return [element(type, props)]
  }
  throw new TypeError(`${String(child)} can't be shown`)
}

function textNode(text: string): number {
  const node = cmd.createNode(cmd.KIND_TEXT)
  onCleanup(() => cmd.removeNode(node))
  cmd.setText(node, text)
  return node
}

/** A slot that follows `fn`. */
function follow(fn: () => JSXNode, host: Host): Slot {
  const slot = new Slot()
  const parent = getOwner()
  let content: Owner | null = null
  let text: number | null = null
  let first = true
  createRenderEffect(() => {
    const value = fn()
    untrack(() => {
      const primitive = typeof value === "string" || typeof value === "number"
      if (primitive && text !== null) {
        cmd.setText(text, String(value))
        return
      }
      if (content) dispose(content)
      text = null
      // Owned by the slot's parent, not by this effect, so that a run of the effect that only
      // changes the text keeps the node.
      content = new Owner(parent)
      slot.parts = runWithOwner(content, () => {
        if (!primitive) return instantiate(value, host)
        text = textNode(String(value))
        return [text]
      })
      if (!first) host.refresh()
    })
    first = false
  })
  return slot
}

function element(type: string, props: Record<string, unknown>): number {
  switch (type) {
    case "div":
      break
    case "text":
    case "span":
      return textElement(props as TextProps)
    case "img":
      return imageElement(props as unknown as ImageProps)
    case "video":
      return videoElement(props as unknown as VideoElementProps)
    default:
      throw new TypeError(`<${type}> is not an element of FrameScript; use <div>, <text> or <img>`)
  }
  const node = cmd.createNode(cmd.KIND_ELEMENT)
  onCleanup(() => cmd.removeNode(node))
  const p = props as ElementProps
  if (p.style) bindStyle(node, p.style)
  new Host(node).mount(p.children)
  p.ref?.(node)
  return node
}

function imageElement(props: ImageProps): number {
  const node = cmd.createNode(cmd.KIND_IMAGE)
  onCleanup(() => cmd.removeNode(node))
  if (props.style) bindStyle(node, props.style)
  bindSource(node, props.src)
  props.ref?.(node)
  return node
}

function videoElement(props: VideoElementProps): number {
  const node = cmd.createNode(cmd.KIND_VIDEO)
  onCleanup(() => cmd.removeNode(node))
  if (props.style) bindStyle(node, props.style)
  // Before the time, which is of the source.
  bindSource(node, props.src)
  createRenderEffect(() => {
    const time = read(props.time)
    const shown = props.shown === undefined ? true : !!read(props.shown)
    untrack(() => cmd.setVideoTime(node, time, shown))
  })
  props.ref?.(node)
  return node
}

function bindSource(node: number, src: MaybeAccessor<string>) {
  if (typeof src !== "function") return cmd.setSource(node, src)
  createRenderEffect(() => {
    const s = src()
    untrack(() => cmd.setSource(node, s))
  })
}

/** `<text>`: one run of text, made of its children. */
function textElement(props: TextProps): number {
  const node = cmd.createNode(cmd.KIND_TEXT)
  onCleanup(() => cmd.removeNode(node))
  if (props.style) bindStyle(node, props.style)
  const parts = flattenText(props.children)
  if (parts.some((p) => typeof p === "function")) {
    createRenderEffect(() => {
      const text = parts.map((p) => (typeof p === "function" ? stringOf(p()) : p)).join("")
      untrack(() => cmd.setText(node, text))
    })
  } else {
    cmd.setText(node, parts.join(""))
  }
  props.ref?.(node)
  return node
}

function flattenText(children: JSXNode): (string | (() => JSXNode))[] {
  if (children === null || children === undefined || typeof children === "boolean") return []
  if (Array.isArray(children)) return children.flatMap(flattenText)
  if (typeof children === "function") return [children]
  if (typeof children === "string" || typeof children === "number") return [String(children)]
  throw new TypeError("<text> can only hold text, numbers and functions that give them")
}

function stringOf(value: JSXNode): string {
  if (value === null || value === undefined || typeof value === "boolean") return ""
  if (Array.isArray(value)) return value.map(stringOf).join("")
  if (typeof value === "function") return stringOf(value())
  if (isElement(value)) throw new TypeError("<text> can only hold text")
  return String(value)
}

// --- Control flow ------------------------------------------------------------------------------

type MaybeAccessor<T> = T | Accessor<T>

function read<T>(value: MaybeAccessor<T>): T {
  return typeof value === "function" ? (value as Accessor<T>)() : value
}

/**
 * Shows `children` while `when` is truthy, `fallback` otherwise. What is shown is made again only
 * when that flips.
 */
export function Show(props: {
  when: MaybeAccessor<unknown>
  fallback?: JSXNode
  children?: JSXNode
}): JSXNode {
  const shown = createMemo(() => !!read(props.when))
  return () => (shown() ? props.children : props.fallback)
}

/**
 * One item of `each` after another. Items that stay keep their nodes, whatever else comes and
 * goes; items are told apart by identity.
 */
export function For<T>(props: {
  each: MaybeAccessor<readonly T[]>
  children: (item: T, index: number) => JSXNode
}): JSXNode {
  return mounter((host) => {
    const slot = new Slot()
    const parent = getOwner()
    let made = new Map<T, { owner: Owner; parts: Part[] }>()
    let first = true
    createRenderEffect(() => {
      const items = read(props.each)
      untrack(() => {
        const next = new Map<T, { owner: Owner; parts: Part[] }>()
        const parts: Part[] = []
        items.forEach((item, i) => {
          let m = next.has(item) ? undefined : made.get(item)
          if (m) made.delete(item)
          else {
            const owner = new Owner(parent)
            m = { owner, parts: runWithOwner(owner, () => instantiate(props.children(item, i), host)) }
          }
          if (!next.has(item)) next.set(item, m)
          parts.push(...m.parts)
        })
        for (const m of made.values()) dispose(m.owner)
        made = next
        slot.parts = parts
        if (!first) host.refresh()
      })
      first = false
    })
    return [slot]
  })
}

declare global {
  // deno-lint-ignore no-var
  var React: { createElement: typeof createElement; Fragment: typeof Fragment }

  namespace JSX {
    type Element = JSXNode
    interface IntrinsicElements {
      div: ElementProps
      text: TextProps
      span: TextProps
      img: ImageProps
      video: VideoElementProps
    }
    interface ElementChildrenAttribute {
      children: unknown
    }
  }
}
