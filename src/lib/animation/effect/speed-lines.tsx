import { seconds, useCurrentFrame } from "../../frame"

/**
 * Speed-line overlay (concentric radial rays with jitter).
 *
 * 集中線のオーバーレイ。
 *
 * @example
 * ```tsx
 * import { SpeedLines } from "../src/lib/animation/effect/speed-lines"
 *
 * <SpeedLines />
 * ```
 */
export const SpeedLines = () => {
  const frame = useCurrentFrame()
  const step = Math.floor(frame / 2)
  const fade = Math.min(1, Math.max(0, frame / seconds(0.2)))
  const opacity = fade * 0.78
  const rand = (seed: number) => {
    const x = Math.sin(seed * 97.13 + step * 41.37) * 43758.5453123
    return x - Math.floor(x)
  }
  const jitter = (seed: number) => rand(seed) * 2 - 1
  const driftA = { x: jitter(1.1) * 22, y: jitter(2.2) * 22 }
  const driftB = { x: jitter(3.3) * 18, y: jitter(4.4) * 18 }
  const scaleA = 1.02 + jitter(5.5) * 0.05
  const scaleB = 1.0 + jitter(6.6) * 0.05
  const rotA = jitter(7.7) * 24
  const rotB = jitter(8.8) * 22
  const rotC = jitter(9.9) * 18
  const rotD = jitter(10.1) * 28
  const rayMask =
    "radial-gradient(circle, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,1) 34%, rgba(0,0,0,1) 72%, rgba(0,0,0,0) 88%)"

  return (
    <>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: "200%",
          height: "200%",
          transform: `translate(-50%, -50%) translate(${driftA.x}px, ${driftA.y}px) rotate(${rotA}deg) scale(${scaleA})`,
          transformOrigin: "center",
          opacity,
          backgroundImage:
            "repeating-conic-gradient(from 1deg, rgba(255, 255, 255, 0.9) 0deg 0.6deg, rgba(255, 255, 255, 0) 0.6deg 18deg)",
          maskImage: rayMask,
          WebkitMaskImage: rayMask,
          mixBlendMode: "screen",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: "185%",
          height: "185%",
          transform: `translate(-50%, -50%) translate(${driftB.x}px, ${driftB.y}px) rotate(${rotB}deg) scale(${scaleB})`,
          transformOrigin: "center",
          opacity: opacity * 0.75,
          backgroundImage:
            "repeating-conic-gradient(from 7deg, rgba(255, 255, 255, 0.75) 0deg 0.6deg, rgba(255, 255, 255, 0) 0.6deg 20deg)",
          maskImage: rayMask,
          WebkitMaskImage: rayMask,
          mixBlendMode: "screen",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: "210%",
          height: "210%",
          transform: `translate(-50%, -50%) translate(${-driftA.x * 0.6}px, ${driftA.y * 0.6}px) rotate(${rotC}deg) scale(${scaleA * 1.02})`,
          transformOrigin: "center",
          opacity: opacity * 0.6,
          backgroundImage:
            "repeating-conic-gradient(from 3deg, rgba(255, 255, 255, 0.7) 0deg 0.5deg, rgba(255, 255, 255, 0) 0.5deg 22deg)",
          maskImage: rayMask,
          WebkitMaskImage: rayMask,
          mixBlendMode: "screen",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: "175%",
          height: "175%",
          transform: `translate(-50%, -50%) translate(${-driftB.x * 0.5}px, ${driftB.y * 0.5}px) rotate(${rotD}deg) scale(${scaleB * 0.98})`,
          transformOrigin: "center",
          opacity: opacity * 0.55,
          backgroundImage:
            "repeating-conic-gradient(from 11deg, rgba(255, 255, 255, 0.8) 0deg 0.6deg, rgba(255, 255, 255, 0) 0.6deg 24deg)",
          maskImage: rayMask,
          WebkitMaskImage: rayMask,
          mixBlendMode: "screen",
          pointerEvents: "none",
        }}
      />
    </>
  )
}
