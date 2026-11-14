// The code of the city, typed into an editor that hangs over the city, quieter now.
import { BEZIER_EASE_IN_OUT, For, seconds, useAnimation, useCurrentFrame, useVariable } from "framescript"
import { DirectionalLight, HemisphereLight, Panel, PerspectiveCamera, Scene3D } from "framescript/3d"
import { useKick } from "../beat.ts"
import { Caption, finish, FULL, MONO, SANS } from "../common.tsx"
import { City, FOG } from "./city.tsx"

const SOURCE = `export function CityScene() {
  const kick = useKick()
  return (
    <Scene3D background="#070a1c" effects={finish()}>
      <PerspectiveCamera position={eye} lookAt={target} />
      <Mesh
        geometry={columns(48, 0.5, 0.4)}
        material={{
          wgsl: city,
          uniforms: { kick, energy: 1, grid: 48 },
        }}
      />
    </Scene3D>
  )
}`

const COLORS = {
  keyword: "#c084fc",
  tag: "#38bdf8",
  name: "#fcd34d",
  string: "#86efac",
  number: "#fb923c",
  prop: "#7dd3fc",
  plain: "#e2e8f0",
  punct: "#94a3b8",
}

interface Token {
  text: string
  color: string
  /** How many characters come before it in the source. */
  at: number
}

/** Just enough of TSX to color this. */
function tokenize(source: string): Token[][] {
  const rule =
    /(\s+)|(export|function|const|return)\b|(<\/?[A-Z]\w*|\/?>)|("[^"]*")|(\d+(?:\.\d+)?)|(\w+)(?==)|(\w+)(?=\()|(\w+)(?=:)|(\w+)|(.)/g
  const lines: Token[][] = [[]]
  let at = 0
  for (const m of source.matchAll(rule)) {
    const text = m[0]
    const color = m[2] ? COLORS.keyword
      : m[3] ? COLORS.tag
      : m[4] ? COLORS.string
      : m[5] ? COLORS.number
      : m[6] ? COLORS.prop
      : m[7] ? COLORS.name
      : m[8] ? COLORS.prop
      : m[9] ? COLORS.plain
      : COLORS.punct
    // Space is cut at the ends of lines.
    const parts = text.split("\n")
    parts.forEach((part, k) => {
      if (k > 0) {
        lines.push([])
        at += 1
      }
      if (part) lines[lines.length - 1].push({ text: part, color, at })
      at += part.length
    })
  }
  return lines
}

const LINES = tokenize(SOURCE)

export function CodeScene() {
  const frame = useCurrentFrame()
  const kick = useKick()
  const typed = useVariable(0)
  const turn = useVariable(-28)
  useAnimation(async (ctx) => {
    ctx.move(turn).to(-6, seconds(6), BEZIER_EASE_IN_OUT)
    await ctx.sleep(seconds(0.5))
    await ctx.move(typed).to(SOURCE.length, seconds(4))
  })
  const shown = (t: Token) => () => t.text.slice(0, Math.max(0, Math.floor(typed()) - t.at))
  const line = () => SOURCE.slice(0, Math.floor(typed())).split("\n").length - 1

  return (
    <Scene3D style={FULL} background={FOG} effects={finish({ bloom: 0.7, threshold: 0.7 })}>
      <PerspectiveCamera
        position={() => [1.3 - frame() * 0.002, 2.6, 6.0 - frame() * 0.004]}
        lookAt={[0.75, 2.2, 0.6]}
        fov={40}
      />
      <HemisphereLight color="#6366f1" groundColor="#020617" intensity={0.25} />
      <DirectionalLight position={[-4, 8, 6]} color="#c7d2fe" intensity={0.6} />
      <City kick={kick} energy={() => 0.45} />

      <Panel position={[0.95, 2.4, 0.6]} rotation={() => [0, turn(), 0]} pixelsPerUnit={360}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 1180,
            borderRadius: 22,
            background: "rgba(10, 12, 24, 0.9)",
            border: "2px solid rgba(148, 163, 184, 0.35)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              padding: "16px 22px",
            }}
          >
            <div style={{ width: 16, height: 16, borderRadius: 8, background: "#f87171" }} />
            <div style={{ width: 16, height: 16, borderRadius: 8, background: "#fbbf24" }} />
            <div style={{ width: 16, height: 16, borderRadius: 8, background: "#4ade80" }} />
            <text style={{ fontFamily: MONO, fontSize: 20, color: "#94a3b8", marginLeft: 18 }}>scenes/city.tsx</text>
          </div>
          <div style={{ height: 1, background: "rgba(148, 163, 184, 0.2)" }} />
          <div style={{ display: "flex", flexDirection: "column", padding: "18px 0 24px 0" }}>
            <For each={LINES}>
              {(tokens, i) => (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "row",
                    height: 36,
                    alignItems: "center",
                    background: () => (line() === i ? "rgba(56, 189, 248, 0.08)" : "rgba(0, 0, 0, 0)"),
                  }}
                >
                  <text style={{ fontFamily: MONO, fontSize: 24, color: "#475569", width: 70, textAlign: "right", marginRight: 26 }}>
                    {String(i + 1)}
                  </text>
                  <For each={tokens}>
                    {(t) => <text style={{ fontFamily: MONO, fontSize: 24, color: t.color, whiteSpace: "pre" }}>{shown(t)}</text>}
                  </For>
                  {/* The caret, at the end of what is typed. */}
                  <div
                    style={{
                      width: 3,
                      height: 28,
                      marginLeft: 2,
                      background: "#e2e8f0",
                      opacity: () => (line() === i && Math.floor(frame() / 16) % 2 === 0 ? 1 : 0),
                    }}
                  />
                </div>
              )}
            </For>
          </div>
        </div>
      </Panel>

      <Caption
        index="04"
        label="THE VIDEO IS THE CODE"
        title="Everything you saw is TSX."
        body="Change a number, and the next frame shows it."
        from={seconds(1)}
        to={seconds(6)}
      />
      <text style={{ position: "absolute", right: 96, top: 80, fontFamily: SANS, fontSize: 20, color: "#64748b", letterSpacing: 2 }}>
        {() => `${Math.floor(typed())} / ${SOURCE.length} characters`}
      </text>
    </Scene3D>
  )
}
