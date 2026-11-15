# The one rule: functions are followed

Components run **once** (as in SolidJS, not React). What changes over time is written as a
function, and only the style property or text that reads it is sent again when it changes:

| | |
|---|---|
| `useCurrentFrame()` | an accessor: `frame()` is the frame relative to the clip |
| `useVariable(v)` | an accessor too: `opacity()`, or pass `opacity` as a style value |
| `style={{ x: value }}` | sent once |
| `style={{ x: () => … }}` | followed |
| `<text>{frame}</text>`, `<text>{() => …}</text>` | followed |
| `{frame()}` in JSX | read once, when the component runs: **not** followed |
| `<Show when={() => …}>`, `<For each={…}>` | conditional and keyed lists |

```tsx
function Counter() {
  const frame = useCurrentFrame()
  return (
    <text style={{ opacity: () => Math.min(1, frame() / 30) }}>
      {() => `frame ${frame()}`}
    </text>
  )
}
```

Attributes of SVG shapes and of things in 3D are followed the same way: any of them can be a
function or a variable.

The reactive core is SolidJS's, under the same names: `createSignal`, `createMemo`,
`createEffect`, `createRoot`, `batch`, `untrack`, `onCleanup`, `createContext` / `useContext`,
`getOwner` / `runWithOwner`.

Keep a frame a function of its number: derive what is shown from the frame (and from variables,
which animations move), not from what earlier frames left behind. The preview seeks, and an export
draws stretches of frames on several workers at once, so a frame is not always drawn after the one
before it.
