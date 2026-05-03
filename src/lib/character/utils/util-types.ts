import type { Variable, VariableType } from "../../animation"

export type OneOrMany<T> = T | T[]

export type Entries<T> = [keyof T, T[keyof T]][]

export type TypedRecord<T extends Record<string, any>> = {
  [K in keyof T]: T[K]
}

export type Variables<T extends Record<string, VariableType>> = {
  [K in keyof T]: Variable<T[K]>
}
