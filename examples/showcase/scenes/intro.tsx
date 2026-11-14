// A nebula comes up out of the dark, the title comes out of a blur, and everything rushes at the
// camera as the riser climbs to the drop.
import {
  BEZIER_ACCELERATE,
  BEZIER_EASE_IN_OUT,
  BEZIER_OVERSHOOT_SOFT,
  BEZIER_SMOOTH,
  BEZIER_SNAPPY,
  seconds,
  Shader,
  useAnimation,
  useVariable,
} from "framescript"
import { FULL, MONO, Rise, SANS } from "../common.tsx"
import nebula from "../shaders/nebula.wgsl"

export function Intro() {
  const reveal = useVariable(0)
  const zoom = useVariable(1)
  const rule = useVariable(0)
  const title = useVariable(0)
  const two = useVariable(0)
  const tagline = useVariable(0)
  const rush = useVariable(0)

  useAnimation(async (ctx) => {
    ctx.move(reveal).to(1, seconds(2.5), BEZIER_EASE_IN_OUT)
    ctx.move(zoom).to(1.35, seconds(6), BEZIER_EASE_IN_OUT)
    await ctx.sleep(seconds(0.6))
    await ctx.move(rule).to(1, seconds(0.9), BEZIER_SNAPPY)
    await ctx.move(title).to(1, seconds(1.4), BEZIER_SMOOTH)
    await ctx.move(two).to(1, seconds(0.7), BEZIER_OVERSHOOT_SOFT)
    await ctx.move(tagline).to(1, seconds(0.8), BEZIER_SMOOTH)
    await ctx.waitUntil(seconds(5))
    await ctx.move(rush).to(1, seconds(1), BEZIER_ACCELERATE)
  })

  return (
    <Shader
      wgsl={nebula}
      uniforms={{
        deep: "#05040f",
        glow: "#3b1d8f",
        hot: "#22d3ee",
        reveal,
        drift: 0.12,
        zoom: () => zoom() + rush() * 0.8,
      }}
      style={{ ...FULL, display: "flex", justifyContent: "center", alignItems: "center" }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 26,
          scale: () => 1 + rush() * rush() * 0.9,
          opacity: () => 1 - rush() * rush(),
          filter: () => `blur(${(rush() * rush() * 18).toFixed(2)}px)`,
        }}
      >
        <text style={{ fontFamily: MONO, fontSize: 24, letterSpacing: 14, color: "#a5f3fc", opacity: rule }}>
          A VIDEO MADE OF CODE
        </text>
        <div style={{ width: () => rule() * 640, height: 2, background: "#67e8f9", opacity: rule }} />
        <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end" }}>
          <Rise
            text="FrameScript"
            progress={title}
            spread={0.6}
            style={{ fontFamily: SANS, fontSize: 168, fontWeight: "bold", color: "#f8fafc", letterSpacing: -2 }}
          />
          <div style={{ position: "relative", marginLeft: 10 }}>
            {/* A glow under the 2: the same glyph, blurred. */}
            <text
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                fontFamily: SANS,
                fontSize: 168,
                fontWeight: "bold",
                color: "#22d3ee",
                opacity: two,
                filter: "blur(28px)",
              }}
            >
              2
            </text>
            <text
              style={{
                fontFamily: SANS,
                fontSize: 168,
                fontWeight: "bold",
                color: "#67e8f9",
                opacity: two,
                scale: () => 0.4 + two() * 0.6,
              }}
            >
              2
            </text>
          </div>
        </div>
        <text
          style={{
            fontFamily: SANS,
            fontSize: 34,
            color: "#cbd5e1",
            opacity: tagline,
            letterSpacing: () => 12 - tagline() * 9,
            translate: () => [0, (1 - tagline()) * 20],
          }}
        >
          Written in TSX. Drawn by the GPU.
        </text>
      </div>
    </Shader>
  )
}
