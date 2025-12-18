import React from "react"
import { THEME } from "../theme"

export const GlassPanel = ({
  children,
  style,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
}) => {
  return (
    <div
      style={{
        background: THEME.panel,
        border: `1px solid ${THEME.border}`,
        borderRadius: 16,
        boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export const Pill = ({
  children,
  style,
}: {
  children: React.ReactNode
  style?: React.CSSProperties
}) => (
  <div
    style={{
      padding: "8px 12px",
      borderRadius: 999,
      border: `1px solid ${THEME.border}`,
      background: "rgba(15, 23, 42, 0.75)",
      color: THEME.muted,
      fontSize: 12,
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      ...style,
    }}
  >
    {children}
  </div>
)

