/**
 * Layout helpers.
 */

import { createElement, type JSXNode } from "./jsx.ts"
import type { StyleProps } from "./style.ts"

/** A box over the whole frame (or the box it is in), its children centered unless styled. */
export function FillFrame(props: { style?: StyleProps; children?: JSXNode }): JSXNode {
  return createElement("div", {
    style: {
      position: "absolute",
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      ...props.style,
    },
  }, props.children)
}
