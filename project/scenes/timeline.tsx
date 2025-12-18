import { useMemo } from "react"
import { useCurrentFrame } from "../../src/lib/frame"
import { easeInOutCubic, easeOutExpo, fadeInOut, frameProgress, lerp } from "../../src/lib/anim"
import { FillFrame } from "../../src/lib/layout/fill-frame"
import { THEME } from "../theme"
import { GlassPanel, Pill } from "../components/panels"
import { MOG } from "../mog"

const MiniTimeline = ({ progress }: { progress: number }) => {
  const playheadX = `${lerp(8, 92, progress)}%`
  return (
    <GlassPanel style={{ padding: 22, borderRadius: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ color: THEME.text, fontWeight: 750, letterSpacing: "-0.01em" }}>Timeline</div>
        <Pill>
          <span style={{ opacity: 0.7 }}>playhead</span>
          <span style={{ color: THEME.text, opacity: 0.9 }}>{Math.round(progress * 100)}%</span>
        </Pill>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {["#22d3ee", "#a78bfa", "#f59e0b"].map((c) => (
            <div key={c} style={{ width: 10, height: 10, borderRadius: 99, background: c, opacity: 0.9 }} />
          ))}
        </div>
      </div>

      <div style={{ marginTop: 16, position: "relative", height: 120 }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 12, background: "rgba(3, 7, 18, 0.65)", border: `1px solid ${THEME.border}` }} />

          {[
            { top: 16, left: 8, width: 34, color: THEME.accent },
            { top: 44, left: 16, width: 48, color: THEME.accent2 },
            { top: 16, left: 48, width: 26, color: THEME.warn },
            { top: 44, left: 68, width: 22, color: THEME.accent },
          ].map((c, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              top: c.top,
              left: `${c.left}%`,
              width: `${c.width}%`,
              height: 22,
              borderRadius: 8,
              background: `linear-gradient(90deg, ${c.color}, rgba(255,255,255,0.10))`,
              boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
              opacity: 0.92,
            }}
          />
        ))}

        <div
          style={{
            position: "absolute",
            top: 12,
            bottom: 12,
            left: playheadX,
            width: 2,
            background: THEME.warn,
            boxShadow: "0 0 0 4px rgba(245,158,11,0.18), 0 10px 30px rgba(0,0,0,0.35)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 4,
            left: playheadX,
            transform: "translateX(-50%)",
            width: 16,
            height: 16,
            borderRadius: 5,
            background: THEME.warn,
          }}
        />
      </div>
    </GlassPanel>
  )
}

const CodeBlock = ({ highlightLine }: { highlightLine: number }) => {
  const lines = useMemo(
    () => [
      `export const PROJECT = () => (`,
      `  <Project>`,
      `    <TimeLine>`,
      `      <ClipSequence>`,
      `        <Clip duration={seconds(2)}>…</Clip>`,
      `        <Clip duration={seconds(4)}>…</Clip>`,
      `      </ClipSequence>`,
      `    </TimeLine>`,
      `  </Project>`,
      `)`,
    ],
    [],
  )

  return (
    <GlassPanel style={{ padding: 22, borderRadius: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ color: THEME.text, fontWeight: 750, letterSpacing: "-0.01em" }}>Project</div>
        <Pill>
          <span style={{ opacity: 0.7 }}>edit</span>
          <span style={{ color: THEME.text, opacity: 0.9 }}>live</span>
        </Pill>
      </div>
      <div
        style={{
          marginTop: 14,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          fontSize: 16,
          lineHeight: 1.65,
          color: "rgba(226, 232, 240, 0.85)",
          whiteSpace: "pre",
        }}
      >
        {lines.map((line, i) => {
          const idx = i + 1
          const active = idx === highlightLine
          return (
            <div
              key={idx}
              style={{
                display: "flex",
                gap: 14,
                padding: "4px 10px",
                borderRadius: 10,
                background: active ? "rgba(34,211,238,0.14)" : "transparent",
                border: active ? "1px solid rgba(34,211,238,0.25)" : "1px solid transparent",
              }}
            >
              <span style={{ width: 22, textAlign: "right", opacity: 0.35 }}>{idx}</span>
              <span>{line}</span>
            </div>
          )
        })}
      </div>
    </GlassPanel>
  )
}

export const TimelineScene = ({ durationFrames }: { durationFrames: number }) => {
  const f = useCurrentFrame()
  const contentScale = MOG.contentScale

  const opacity = fadeInOut(f, durationFrames, { in: 14, out: 16 })
  const t = frameProgress(f, 0, durationFrames - 1, easeInOutCubic)
  const progress = easeOutExpo(t)
  const lift = lerp(14, 0, frameProgress(f, 0, 22, easeOutExpo))

  const highlight = 4 + Math.floor(frameProgress(f, 0, durationFrames - 1, easeInOutCubic) * 3)

  return (
    <FillFrame>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(1000px 700px at 70% 35%, rgba(34,211,238,0.16), transparent 60%),
                      radial-gradient(900px 680px at 25% 20%, rgba(167,139,250,0.16), transparent 60%),
                      linear-gradient(180deg, ${THEME.bg0}, ${THEME.bg1})`,
        }}
      />
      <div style={{ position: "absolute", inset: 0, opacity: 0.10, animation: "mgGlow 1s ease-in-out infinite", background: "radial-gradient(closest-side at 50% 10%, rgba(255,255,255,0.12), transparent 75%)" }} />

      <div style={{ position: "absolute", inset: 0, padding: MOG.padding, opacity }}>
        <div
          style={{
            maxWidth: 1320 / contentScale,
            margin: "0 auto",
            transform: `translateY(${MOG.timelineOffsetY}px) scale(${contentScale})`,
            transformOrigin: "top center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12, transform: `translateY(${lift}px)` }}>
            <Pill style={{ color: THEME.text }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: THEME.warn }} />
              Edit → Preview → Render
            </Pill>
            <div style={{ color: THEME.muted, fontSize: 16 }}>
              currentFrame で動かして、最後に音声も合成
            </div>
          </div>

          <div
            className="mg-title"
            style={{
              marginTop: 18,
              fontSize: 70,
              fontWeight: 850,
              color: THEME.text,
              letterSpacing: "-0.02em",
            }}
          >
            タイムラインとコードが同期
          </div>

          <div style={{ marginTop: 22, display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 16, alignItems: "start" }}>
            <div style={{ transform: `translateY(${lerp(18, 0, frameProgress(f, 8, 34, easeOutExpo))}px)` }}>
              <CodeBlock highlightLine={highlight} />
            </div>
            <div style={{ transform: `translateY(${lerp(22, 0, frameProgress(f, 14, 40, easeOutExpo))}px)` }}>
              <MiniTimeline progress={progress} />
            </div>
          </div>
        </div>
      </div>
    </FillFrame>
  )
}
