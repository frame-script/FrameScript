import { useCallback, useMemo, useState } from "react"
import { useTimelineClips, useClipVisibilityState } from "../lib/timeline"
import { useEditor } from "./editor-context"

type ClipMatch = {
  filePath: string
  line: number
  column?: number
}

export const ClipVisibilityPanel = () => {
  const clips = useTimelineClips()
  const { hiddenMap, setClipVisibility } = useClipVisibilityState()
  const { openFile } = useEditor()
  const [matchDialog, setMatchDialog] = useState<{
    label: string
    matches: ClipMatch[]
  } | null>(null)
  const [jumpError, setJumpError] = useState<string | null>(null)
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

  const formatPath = useCallback((filePath: string) => {
    const normalized = filePath.replace(/\\/g, "/")
    const marker = "/project/"
    const idx = normalized.lastIndexOf(marker)
    if (idx >= 0) {
      return normalized.slice(idx + 1)
    }
    return normalized
  }, [])

  const handleJumpToClip = useCallback(async (label: string) => {
    setJumpError(null)
    if (!window.editorAPI?.findClipLabel) {
      setJumpError("Editor API is unavailable.")
      return
    }
    try {
      const matches = await window.editorAPI.findClipLabel(label)
      if (!matches || matches.length === 0) {
        setJumpError(`No match found for "${label}".`)
        return
      }
      if (matches.length === 1) {
        const match = matches[0]
        openFile(match.filePath, match.line)
        return
      }
      setMatchDialog({ label, matches })
    } catch (error) {
      console.error("Failed to jump to clip", error)
      setJumpError("Failed to locate clip source.")
    }
  }, [openFile])

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
        position: "relative",
      }}
    >
      <style>{scrollbarStyles}</style>
      <div style={{ fontWeight: 600, fontSize: 13, color: "#cbd5e1" }}>Clips</div>
      {jumpError ? (
        <div
          style={{
            padding: "6px 8px",
            borderRadius: 6,
            border: "1px solid #3f1d1d",
            background: "#1f0f12",
            color: "#fca5a5",
            fontSize: 11,
          }}
        >
          {jumpError}
        </div>
      ) : null}
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
          const canJump = Boolean(clip.label)
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
              <button
                type="button"
                disabled={!canJump}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (!clip.label) return
                  void handleJumpToClip(clip.label)
                }}
                style={{
                  flex: "1 1 auto",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  margin: 0,
                  textAlign: "left",
                  color: canJump ? "inherit" : "#64748b",
                  cursor: canJump ? "pointer" : "not-allowed",
                  fontSize: "inherit",
                }}
              >
                {label}
              </button>
            </label>
          )
        })}
      </div>

      {matchDialog ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2, 6, 23, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: 420,
              maxWidth: "90vw",
              maxHeight: "70vh",
              overflow: "auto",
              background: "#0b1221",
              border: "1px solid #1f2a3c",
              borderRadius: 10,
              padding: 12,
              color: "#e2e8f0",
              boxShadow: "0 20px 40px rgba(0,0,0,0.4)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              Multiple matches for "{matchDialog.label}"
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {matchDialog.matches.map((match) => (
                <button
                  key={`${match.filePath}:${match.line}`}
                  type="button"
                  onClick={() => {
                    openFile(match.filePath, match.line)
                    setMatchDialog(null)
                  }}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: "1px solid #1f2a3c",
                    background: "#0f172a",
                    color: "#e5e7eb",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{formatPath(match.filePath)}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>Line {match.line}</div>
                </button>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setMatchDialog(null)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid #1f2a3c",
                  background: "#111827",
                  color: "#cbd5e1",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
