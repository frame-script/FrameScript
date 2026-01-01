import { useCallback, useMemo } from "react"
import { useTimelineClips, useClipVisibilityState } from "../lib/timeline"

export const ClipVisibilityPanel = () => {
  const clips = useTimelineClips()
  const { hiddenMap, setClipVisibility } = useClipVisibilityState()
  const scrollbarStyles = `
  .fs-scroll {
    scrollbar-color: #334155 #0f172a;
  }
  .fs-scroll::-webkit-scrollbar {
    width: 8px;
  }
  .fs-scroll::-webkit-scrollbar-track {
    background: #0f172a;
    border-radius: 999px;
  }
  .fs-scroll::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, #1f2937, #334155);
    border-radius: 999px;
    border: 2px solid #0f172a;
  }
  .fs-scroll::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(180deg, #2b384c, #4b5563);
  }
  `

  const sorted = useMemo(
    () => [...clips].sort((a, b) => a.start - b.start || a.end - b.end),
    [clips],
  )
  const clipMap = useMemo(() => {
    const map = new Map<string, { parentId?: string | null }>()
    clips.forEach((c) => map.set(c.id, { parentId: c.parentId ?? null }))
    return map
  }, [clips])

  const isClipVisible = useCallback(
    (clipId: string) => {
      let cursor: string | null | undefined = clipId
      while (cursor) {
        if (hiddenMap[cursor]) return false
        cursor = clipMap.get(cursor)?.parentId ?? null
      }
      return true
    },
    [clipMap, hiddenMap],
  )

  return (
    <div
      style={{
        width: "100%",
        minWidth: 0,
        height: "100%",
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
        minHeight: 0,
      }}
    >
      <style>{scrollbarStyles}</style>
      <div style={{ fontWeight: 600, fontSize: 13, color: "#cbd5e1" }}>Clips</div>
      <div
        className="fs-scroll"
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          overflow: "auto",
          paddingRight: 2,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {sorted.map((clip, idx) => {
          const isVisible = isClipVisible(clip.id)
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
    </div>
  )
}
