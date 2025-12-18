import React, { useMemo } from "react"
import { useCurrentFrame } from "../../src/lib/frame"
import { easeInOutCubic, easeOutExpo, fadeInOut, frameProgress, lerp } from "../../src/lib/anim"
import { FillFrame } from "../../src/lib/layout/fill-frame"
import { THEME } from "../theme"
import { Pill } from "../components/panels"

export const IntroScene = ({ durationFrames }: { durationFrames: number }) => {
  const f = useCurrentFrame()

  const appear = frameProgress(f, 0, 28, easeOutExpo)
  const settle = frameProgress(f, 8, 48, easeOutExpo)
  const out = frameProgress(f, Math.max(0, durationFrames - 34), durationFrames - 1, easeInOutCubic)
  const opacity = fadeInOut(f, durationFrames, { in: 16, out: 18 }) * (1 - out * 0.35)

  const titleY = lerp(28, 0, settle)
  const titleScale = lerp(0.98, 1, appear)
  const glow = useMemo(() => {
    const t = frameProgress(f, 0, durationFrames - 1, easeInOutCubic)
    return lerp(0.35, 0.6, t)
  }, [f, durationFrames])

  return (
    <FillFrame>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(900px 540px at 20% 20%, rgba(34,211,238,0.20), transparent 60%),
                      radial-gradient(900px 620px at 80% 30%, rgba(167,139,250,0.18), transparent 60%),
                      linear-gradient(180deg, ${THEME.bg0}, ${THEME.bg1})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: -60,
          background:
            "repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 18px)",
          opacity: 0.07,
          transform: `translateY(${lerp(16, 0, appear)}px) rotate(-4deg)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.32,
          background:
            "radial-gradient(closest-side at 50% 30%, rgba(255,255,255,0.12), transparent 70%)",
          animation: "mgGlow 1s ease-in-out infinite",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.12,
          background: "linear-gradient(180deg, transparent, rgba(0,0,0,0.45))",
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 120,
          opacity,
        }}
      >
        <div style={{ maxWidth: 1180, width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Pill style={{ color: THEME.text }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: THEME.accent }} />
              Code-first motion graphics
            </Pill>
            <Pill>
              <span style={{ opacity: 0.7 }}>fps</span>
              <span style={{ color: THEME.text, opacity: 0.9 }}>60</span>
              <span style={{ opacity: 0.55 }}>|</span>
              <span style={{ opacity: 0.7 }}>render</span>
              <span style={{ color: THEME.text, opacity: 0.9 }}>headless</span>
            </Pill>
          </div>

          <div
            style={{
              marginTop: 26,
              transform: `translateY(${titleY}px) scale(${titleScale})`,
              transformOrigin: "left center",
            }}
          >
            <div
              className="mg-title"
              style={{
                fontSize: 92,
                fontWeight: 800,
                lineHeight: 1.0,
                color: THEME.text,
                textShadow: `0 20px 60px rgba(0,0,0,0.55), 0 0 42px rgba(34,211,238,${glow})`,
              }}
            >
              FrameScript
            </div>
            <div
              style={{
                marginTop: 12,
                fontSize: 20,
                lineHeight: 1.5,
                color: THEME.muted,
                maxWidth: 880,
              }}
            >
              React と CSS で描いて、Electron + Rust で書き出す。
              <span style={{ color: THEME.text, opacity: 0.92 }}> “編集しながら作る”</span> モーショングラフィックス。
            </div>
          </div>

          <div style={{ marginTop: 34, position: "relative", height: 18 }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 999,
                background: "rgba(15, 23, 42, 0.7)",
                border: `1px solid ${THEME.border}`,
              }}
            />
            <div
              style={{
                position: "absolute",
                top: -26,
                bottom: -26,
                width: "35%",
                left: 0,
                background: "linear-gradient(90deg, transparent, rgba(34,211,238,0.55), transparent)",
                animation: "mgSweep 1s ease-in-out infinite",
                borderRadius: 999,
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 3,
                borderRadius: 999,
                width: `${lerp(0.12, 1, frameProgress(f, 10, durationFrames - 22, easeInOutCubic)) * 100}%`,
                background: `linear-gradient(90deg, ${THEME.accent}, ${THEME.accent2})`,
                boxShadow: "0 10px 26px rgba(0,0,0,0.35)",
                opacity: 0.9,
              }}
            />
          </div>
        </div>
      </div>
    </FillFrame>
  )
}

