import type { CSSProperties } from "react"

type OutlineTextProps = {
  text: string
  size?: number
  weight?: number
  color?: string
  outlineColor?: string
  outlineWidth?: number
  shadow?: string
  letterSpacing?: number | string
  lineHeight?: number | string
  fontFamily?: string
  style?: CSSProperties
}

export const OutlineText = ({
  text,
  size = 78,
  weight = 700,
  color = "#ffffff",
  outlineColor = "#000000",
  outlineWidth = 10,
  shadow = "0 0 16px rgba(0, 0, 0, 0.45)",
  letterSpacing = "0.04em",
  lineHeight = 1,
  fontFamily,
  style,
}: OutlineTextProps) => {
  const baseStyle: CSSProperties = {
    position: "relative",
    display: "inline-block",
    fontSize: size,
    fontWeight: weight,
    letterSpacing,
    lineHeight,
    fontFamily,
  }

  return (
    <span style={style ? { ...baseStyle, ...style } : baseStyle}>
      <span
        style={{
          position: "absolute",
          inset: 0,
          WebkitTextStroke: `${outlineWidth}px ${outlineColor}`,
          WebkitTextFillColor: "transparent",
          color: "transparent",
          textShadow: shadow,
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </span>
      <span style={{ position: "relative", color, whiteSpace: "nowrap" }}>{text}</span>
    </span>
  )
}
