/**
 * Fine-grained reactivity in the manner of SolidJS.
 *
 * Components run once. What may change is a function (an "accessor"); effects that read it run
 * again when it changes, and nothing else does. Propagation is push-then-pull with three states
 * (Clean / Check / Dirty), like AntiWebUI's own runtime: a write marks what reads the signal
 * Dirty and what is further down Check, and a memo that recomputes to an equal value stops there.
 * Nothing ever sees a mix of old and new values.
 *
 * Solid の考え方のリアクティブ。コンポーネントは一度だけ実行され、変わりうる場所は関数で表す。
 */

export type Accessor<T> = () => T
export type Setter<T> = (value: T | ((previous: T) => T)) => T
export type Equals<T> = (a: T, b: T) => boolean

const CLEAN = 0
const CHECK = 1
const DIRTY = 2

/** Owns what is made while it runs: computations, child owners, cleanups and context. */
export class Owner {
  owner: Owner | null
  owned: Owner[] | null = null
  cleanups: (() => void)[] | null = null
  context: Map<symbol, unknown> | null = null
  disposed = false

  constructor(owner: Owner | null) {
    this.owner = owner
    if (owner) (owner.owned ??= []).push(this)
  }
}

class SignalNode<T> {
  observers: Computation<unknown>[] = []
  constructor(public value: T, public equals: Equals<T> | false) {}
}

class Computation<T> extends Owner {
  state = DIRTY
  sources: Source[] = []
  /** Memos are read by others; effects are not. */
  observers: Computation<unknown>[] | null
  value: T | undefined
  /** It has run before, so `value` is one of its results. */
  ran = false
  constructor(
    owner: Owner | null,
    public fn: (previous: T | undefined) => T,
    public equals: Equals<T> | false | null,
  ) {
    super(owner)
    this.observers = equals === null ? null : []
  }
}

type Source = SignalNode<unknown> | Computation<unknown>

let currentOwner: Owner | null = null
let listener: Computation<unknown> | null = null
let batchDepth = 0
let flushing = false
let queue: Computation<unknown>[] = []

/** A value that can be read (and depended on) and written. */
export function createSignal<T>(
  value: T,
  options?: { equals?: Equals<T> | false },
): [Accessor<T>, Setter<T>] {
  const node = new SignalNode(value, options?.equals ?? Object.is)
  const read = () => {
    track(node as SignalNode<unknown>)
    return node.value
  }
  const write: Setter<T> = (next) => {
    const value = typeof next === "function" ? (next as (p: T) => T)(node.value) : next
    if (node.equals && node.equals(node.value, value)) return value
    node.value = value
    mark(node.observers, DIRTY)
    if (batchDepth === 0 && !flushing) flush()
    return value
  }
  return [read, write]
}

/** A value derived from others. It is computed once now, and again only when what it read changed. */
export function createMemo<T>(fn: (previous: T | undefined) => T, equals?: Equals<T> | false): Accessor<T> {
  const c = new Computation(currentOwner, fn, equals ?? Object.is)
  update(c as Computation<unknown>)
  return () => {
    if (c.state !== CLEAN) updateIfNecessary(c as Computation<unknown>)
    track(c as Computation<unknown>)
    return c.value as T
  }
}

/** Runs `fn` now and again whenever what it read changes. */
export function createEffect<T>(fn: (previous: T | undefined) => T): void {
  const c = new Computation(currentOwner, fn, null)
  update(c as Computation<unknown>)
}

/** The same as [`createEffect`]; effects that write to nodes are called this in Solid. */
export const createRenderEffect = createEffect

/** Defers propagation until `fn` returns, so that what reads several signals runs once. */
export function batch<T>(fn: () => T): T {
  batchDepth++
  try {
    return fn()
  } finally {
    batchDepth--
    if (batchDepth === 0 && !flushing) flush()
  }
}

/** Runs `fn` without depending on what it reads. */
export function untrack<T>(fn: () => T): T {
  const previous = listener
  listener = null
  try {
    return fn()
  } finally {
    listener = previous
  }
}

/** Runs `fn` with an owner that lives until `dispose` is called. */
export function createRoot<T>(fn: (dispose: () => void) => T, parent: Owner | null = null): T {
  const root = new Owner(parent)
  return runWithOwner(root, () => fn(() => dispose(root)))
}

/** Called when the current owner is disposed or runs again. */
export function onCleanup(fn: () => void): void {
  if (currentOwner) (currentOwner.cleanups ??= []).push(fn)
}

export function getOwner(): Owner | null {
  return currentOwner
}

export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  const previousOwner = currentOwner
  const previousListener = listener
  currentOwner = owner
  listener = null
  try {
    return fn()
  } finally {
    currentOwner = previousOwner
    listener = previousListener
  }
}

/** Disposes `owner` and everything it owns. */
export function dispose(owner: Owner): void {
  if (owner.disposed) return
  clean(owner)
  owner.disposed = true
  const parent = owner.owner
  if (parent?.owned) {
    const i = parent.owned.indexOf(owner)
    if (i >= 0) parent.owned.splice(i, 1)
  }
}

// --- Context -----------------------------------------------------------------------------------

export interface Context<T> {
  id: symbol
  defaultValue: T
}

export function createContext<T>(defaultValue: T, name = "context"): Context<T> {
  return { id: Symbol(name), defaultValue }
}

export function useContext<T>(context: Context<T>): T {
  for (let o = currentOwner; o; o = o.owner) {
    if (o.context?.has(context.id)) return o.context.get(context.id) as T
  }
  return context.defaultValue
}

/** Runs `fn` with `value` provided for `context` to what it makes. */
export function withContext<T, R>(context: Context<T>, value: T, fn: () => R): R {
  const owner = new Owner(currentOwner)
  owner.context = new Map([[context.id, value]])
  return runWithOwner(owner, fn)
}

// --- Inside ------------------------------------------------------------------------------------

function track(source: Source) {
  if (!listener) return
  if (listener.sources.includes(source)) return
  listener.sources.push(source)
  source.observers!.push(listener)
}

function mark(observers: Computation<unknown>[], state: number) {
  for (const o of observers) {
    if (o.state >= state) continue
    const was = o.state
    o.state = state
    if (was !== CLEAN) continue
    if (o.observers) mark(o.observers, CHECK)
    else queue.push(o)
  }
}

function updateIfNecessary(c: Computation<unknown>) {
  if (c.state === CHECK) {
    for (const s of c.sources) {
      if (s instanceof Computation && s.state !== CLEAN) {
        updateIfNecessary(s)
        if ((c.state as number) === DIRTY) break
      }
    }
  }
  if (c.state === DIRTY) update(c)
  c.state = CLEAN
}

function update(c: Computation<unknown>) {
  if (c.disposed) return
  clean(c)
  const previousOwner = currentOwner
  const previousListener = listener
  currentOwner = c
  listener = c
  let next: unknown
  try {
    next = c.fn(c.value)
  } finally {
    currentOwner = previousOwner
    listener = previousListener
  }
  c.state = CLEAN
  if (c.observers && !(c.ran && c.equals && c.equals(c.value, next))) {
    for (const o of c.observers) o.state = DIRTY
  }
  c.value = next
  c.ran = true
}

/** Lets go of what `owner` made and of what it depended on, so that it can run again. */
function clean(owner: Owner) {
  if (owner.owned) {
    const owned = owner.owned
    owner.owned = null
    for (const o of owned) {
      clean(o)
      o.disposed = true
    }
  }
  if (owner.cleanups) {
    const cleanups = owner.cleanups
    owner.cleanups = null
    for (const f of cleanups) f()
  }
  if (owner instanceof Computation) {
    for (const s of owner.sources) {
      const i = s.observers!.indexOf(owner)
      if (i >= 0) s.observers!.splice(i, 1)
    }
    owner.sources = []
  }
}

const LOOP_LIMIT = 100_000

function flush() {
  flushing = true
  let runs = 0
  try {
    while (queue.length) {
      const effects = queue
      queue = []
      for (const e of effects) {
        if (e.disposed) continue
        if (++runs > LOOP_LIMIT) {
          throw new Error("effects kept writing what they read: there is a loop among them")
        }
        updateIfNecessary(e)
      }
    }
  } finally {
    flushing = false
    queue = []
  }
}
