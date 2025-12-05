import { useMemo } from "react"
import { useTimelineClips, useClipVisibilityState } from "../lib/timeline"

export const ClipVisibilityPanel = () => {
  const clips = useTimelineClips()
  const { hiddenMap, setClipVisibility } = useClipVisibilityState()

  const sorted = useMemo(
    () => [...clips].sort((a, b) => a.start - b.start || a.end - b.end),
    [clips],
  )

  return (
    <div
      style={{
        width: 180,
        padding: 12,
        borderRadius: 8,
        border: "1px solid #1f2a3c",
        background: "#0b1221",
        color: "#e5e7eb",
        boxShadow: "0 8px 20px rgba(0,0,0,0.25)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        boxSizing: "border-box",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, color: "#cbd5e1" }}>Clips</div>
      {sorted.map((clip, idx) => {
        const isVisible = !hiddenMap[clip.id]
        const label = clip.label ?? `Clip ${idx + 1}`
        return (
          <label
            key={clip.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #1f2a3c",
              background: isVisible ? "linear-gradient(90deg, #1f2937, #111827)" : "#0f172a",
              color: isVisible ? "#e5e7eb" : "#94a3b8",
              cursor: "pointer",
              textAlign: "left",
              userSelect: "none",
              boxSizing: "border-box",
            }}
          >
            <input
              type="checkbox"
              checked={isVisible}
              onChange={(e) => setClipVisibility(clip.id, e.target.checked)}
              style={{ accentColor: "#5bd5ff", width: 14, height: 14, cursor: "pointer" }}
            />
            <span style={{ flex: "1 1 auto", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
          </label>
        )
      })}
    </div>
  )
}
