import React from "react"
import { useCurrentFrame } from "../../src/lib/frame"
import { easeInOutCubic, easeOutExpo, fadeInOut, frameProgress, lerp } from "../../src/lib/anim"
import { FillFrame } from "../../src/lib/layout/fill-frame"
import { THEME } from "../theme"
import { GlassPanel, Pill } from "../components/panels"

export const OutroScene = ({ durationFrames }: { durationFrames: number }) => {
  const f = useCurrentFrame()
  const opacity = fadeInOut(f, durationFrames, { in: 14, out: 18 })
  const inT = frameProgress(f, 0, 26, easeOutExpo)
  const outT = frameProgress(f, Math.max(0, durationFrames - 34), durationFrames - 1, easeInOutCubic)

  const y = lerp(18, 0, inT) + lerp(0, -10, outT)
  const scale = lerp(0.99, 1, inT) * lerp(1, 0.985, outT)

  return (
    <FillFrame>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(900px 700px at 50% 35%, rgba(34,211,238,0.18), transparent 62%),
                      radial-gradient(900px 700px at 60% 55%, rgba(167,139,250,0.16), transparent 62%),
                      linear-gradient(180deg, ${THEME.bg1}, ${THEME.bg0})`,
        }}
      />
      <div style={{ position: "absolute", inset: 0, opacity: 0.10, animation: "mgGlow 1s ease-in-out infinite", background: "radial-gradient(closest-side at 50% 20%, rgba(255,255,255,0.12), transparent 70%)" }} />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          padding: 120,
          opacity,
        }}
      >
        <div style={{ transform: `translateY(${y}px) scale(${scale})`, maxWidth: 1100, width: "100%" }}>
          <GlassPanel style={{ padding: 28, borderRadius: 20 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <Pill style={{ color: THEME.text }}>
                <span style={{ width: 8, height: 8, borderRadius: 99, background: THEME.accent }} />
                FrameScript
              </Pill>
              <Pill>
                <span style={{ opacity: 0.7 }}>ship</span>
                <span style={{ color: THEME.text, opacity: 0.9 }}>motion</span>
                <span style={{ opacity: 0.55 }}>|</span>
                <span style={{ opacity: 0.7 }}>with</span>
                <span style={{ color: THEME.text, opacity: 0.9 }}>web tech</span>
              </Pill>
            </div>

            <div
              className="mg-title"
              style={{
                marginTop: 18,
                fontSize: 60,
                fontWeight: 900,
                color: THEME.text,
                letterSpacing: "-0.03em",
                lineHeight: 1.03,
              }}
            >
              まずは、作ってみよう。
            </div>

            <div style={{ marginTop: 10, color: THEME.muted, fontSize: 16, lineHeight: 1.55 }}>
              `project/` を編集して、プレビューしながら仕上げる。書き出しはメニューから Render…。
            </div>

            <div style={{ marginTop: 18, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: `linear-gradient(90deg, ${THEME.accent}, ${THEME.accent2})`,
                  color: "#06121f",
                  fontWeight: 800,
                  boxShadow: "0 16px 44px rgba(0,0,0,0.40)",
                }}
              >
                Frame by frame, from code.
              </div>
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: `1px solid ${THEME.border}`,
                  background: "rgba(15, 23, 42, 0.6)",
                  color: THEME.text,
                  fontWeight: 700,
                }}
              >
                timeline + render + audio
              </div>
            </div>
          </GlassPanel>
        </div>
      </div>
    </FillFrame>
  )
}

