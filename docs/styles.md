# Styles

CSS properties in camelCase; numbers are pixels. Shorthands (`padding: "8px 16px"`, `border`,
`borderRadius`, `gap`, `flex`, `inset`), `transform` (`translate`, `scale`, `rotate`) and the
separate `translate` / `scale` / `rotate`, `boxShadow`, `filter: blur()`, colors (`#hex`,
`rgb()`, `hsl()`, names), `objectFit` / `objectPosition` for pictures and videos. Elements are
`<div>`, `<text>` (one run of text), `<img>` and `<svg>`. What goes over what is as in CSS: what is
positioned (`position: "relative"` or `"absolute"`) or translucent or transformed goes over the
rest in the order it is written, and `zIndex` (for what is positioned and for flex items) orders
it further. `relative` doesn't move anything with `top` / `left`.

Text can have shadows and strokes, as in CSS: `textShadow: "0 4px 12px rgba(0,0,0,.6)"` (several
with commas, the first on top), and `textStroke: "6px #000"` (`-webkit-text-stroke`; half of it is
outside the letters). With `paintOrder: "stroke"` the strokes go under the letters, which keep
their shape: the edging of captions. Unlike CSS, `textStroke` takes several, the first on top, so
`["6px #fff", "16px #000"]` edges letters in white and then in black. A shadow is of the letters
as they are painted, strokes included; a transparent `color` with a stroke leaves only outlines.
