import React from "react"

export const GlobalStyles = () => (
  <style>{`
    * { box-sizing: border-box; }
    html, body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"; }
    .mg-title { letter-spacing: -0.02em; }
    @keyframes mgGlow {
      0% { opacity: 0.55; transform: translate3d(0,0,0) scale(1); filter: blur(0px); }
      50% { opacity: 0.85; transform: translate3d(0,-2px,0) scale(1.02); filter: blur(0.2px); }
      100% { opacity: 0.55; transform: translate3d(0,0,0) scale(1); filter: blur(0px); }
    }
    @keyframes mgSweep {
      0% { transform: translateX(-55%) skewX(-18deg); opacity: 0; }
      15% { opacity: 0.65; }
      55% { opacity: 0.65; }
      100% { transform: translateX(55%) skewX(-18deg); opacity: 0; }
    }
    @keyframes mgScanline {
      0% { transform: translateY(-120%); opacity: 0; }
      10% { opacity: 0.22; }
      55% { opacity: 0.16; }
      100% { transform: translateY(120%); opacity: 0; }
    }
  `}</style>
)

