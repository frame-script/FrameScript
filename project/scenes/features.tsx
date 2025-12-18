import React from "react"
import { useCurrentFrame } from "../../src/lib/frame"
import { easeInOutCubic, easeOutCubic, fadeInOut, frameProgress, lerp, stagger } from "../../src/lib/anim"
import { FillFrame } from "../../src/lib/layout/fill-frame"
import { THEME } from "../theme"
import { GlassPanel, Pill } from "../components/panels"

const FeatureCard = ({
  title,
  body,
  icon,
  accent,
  style,
}: {
  title: string
  body: string
  icon: React.ReactNode
  accent: string
  style?: React.CSSProperties
}) => (
  <GlassPanel
    style={{
      padding: 22,
      minHeight: 168,
      position: "relative",
      overflow: "hidden",
      ...style,
    }}
  >
    <div
      style={{
        position: "absolute",
        inset: -60,
        background: `radial-gradient(300px 240px at 20% 20%, ${accent}33, transparent 70%)`,
        opacity: 0.9,
      }}
    />
    <div style={{ position: "relative", display: "flex", gap: 14, alignItems: "flex-start" }}>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          display: "grid",
          placeItems: "center",
          background: `linear-gradient(135deg, ${accent}, rgba(255,255,255,0.08))`,
          boxShadow: "0 14px 40px rgba(0,0,0,0.35)",
          flex: "0 0 auto",
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: THEME.text, fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>
          {title}
        </div>
        <div style={{ marginTop: 6, color: THEME.muted, fontSize: 14, lineHeight: 1.55 }}>
          {body}
        </div>
      </div>
    </div>
  </GlassPanel>
)

const IconBrackets = () => (
  <div style={{ color: "#0b1221", fontWeight: 900, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
    {"</>"}
  </div>
)
const IconLayers = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M12 3l9 5-9 5-9-5 9-5Z" stroke="#0b1221" strokeWidth="2" />
    <path d="M3 12l9 5 9-5" stroke="#0b1221" strokeWidth="2" opacity="0.9" />
    <path d="M3 16l9 5 9-5" stroke="#0b1221" strokeWidth="2" opacity="0.7" />
  </svg>
)
const IconRocket = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
    <path d="M12 2c4 1 7 4 8 8-3 3-7 7-10 10-4 1-7 0-8-1 1-1 2-4 1-8 3-3 7-7 8-9Z" stroke="#0b1221" strokeWidth="2" />
    <path d="M10 14l-3 1 1-3" stroke="#0b1221" strokeWidth="2" />
    <circle cx="14" cy="10" r="1.6" fill="#0b1221" />
  </svg>
)

export const FeaturesScene = ({ durationFrames }: { durationFrames: number }) => {
  const f = useCurrentFrame()
  const opacity = fadeInOut(f, durationFrames, { in: 14, out: 16 })

  const headIn = frameProgress(f, 0, 24, easeOutCubic)
  const headY = lerp(18, 0, headIn)

  const cards = [
    {
      title: "React + CSS で描画",
      body: "コンポーネントで構成して、アニメは currentFrame で駆動。CSSアニメも使える。",
      icon: <IconBrackets />,
      accent: THEME.accent,
    },
    {
      title: "タイムラインで編集",
      body: "Clip / ClipSequence で尺を組み立て。可視切り替えやスクラブで確認。",
      icon: <IconLayers />,
      accent: THEME.accent2,
    },
    {
      title: "Headless で書き出し",
      body: "複数ワーカーでフレーム生成→結合→最後に音声を合成して MP4 を出力。",
      icon: <IconRocket />,
      accent: THEME.warn,
    },
  ] as const

  return (
    <FillFrame>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(180deg, ${THEME.bg1}, ${THEME.bg0})`,
        }}
      />
      <div style={{ position: "absolute", inset: 0, opacity: 0.18, animation: "mgScanline 1s ease-in-out infinite", background: "linear-gradient(180deg, transparent, rgba(34,211,238,0.25), transparent)" }} />

      <div style={{ position: "absolute", inset: 0, padding: 120, opacity }}>
        <div style={{ maxWidth: 1240, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, transform: `translateY(${headY}px)` }}>
            <Pill style={{ color: THEME.text }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: THEME.accent2 }} />
              What you can do
            </Pill>
            <div style={{ color: THEME.muted, fontSize: 14 }}>
              Build motion graphics with the same stack you ship apps with
            </div>
          </div>

          <div
            className="mg-title"
            style={{
              marginTop: 22,
              fontSize: 56,
              fontWeight: 850,
              color: THEME.text,
              letterSpacing: "-0.02em",
            }}
          >
            編集しながら動画になる。
          </div>

          <div style={{ marginTop: 26, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {cards.map((card, i) => {
              const start = stagger(i, 10, 10)
              const t = frameProgress(f, start, start + 26, easeOutCubic)
              const y = lerp(22, 0, t)
              const s = lerp(0.98, 1, t)
              const a = frameProgress(f, start, start + 18, easeInOutCubic)
              return (
                <div key={card.title} style={{ transform: `translateY(${y}px) scale(${s})`, opacity: a }}>
                  <FeatureCard {...card} />
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </FillFrame>
  )
}

