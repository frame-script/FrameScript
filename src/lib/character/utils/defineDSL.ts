import type { ReactElement } from "react"

export type DslComponent<P = {}> = {
  (props: P): ReactElement | null
  __dslType: string
}

/**
 * DSL向けに__dslTypeプロパティを持つコンポーネントを作成する
 */
export const defineDSL = <P>(type: string): DslComponent<P> => {
  const C = ((_: P) => null) as DslComponent<P>
  C.__dslType = type
  return C
}
