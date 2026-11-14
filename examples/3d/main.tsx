// WGSL and 3D: a background a shader draws, a scene of shapes, and materials written in WGSL.
import { BEZIER_SMOOTH, Clip, seconds, Sequence, Shader, Timeline, useAnimation, useCurrentFrame, useVariable } from "framescript"
import {
  AmbientLight,
  Box,
  Cone,
  DirectionalLight,
  Group,
  HemisphereLight,
  orbit,
  PerspectiveCamera,
  Plane,
  PointLight,
  Scene3D,
  Sphere,
  Torus,
} from "framescript/3d"
import flag from "./flag.wgsl"
import hologram from "./hologram.wgsl"
import plasma from "./plasma.wgsl"

const FULL = { width: "100%", height: "100%" } as const

export default function Main() {
  return (
    <Timeline>
      <Sequence>
        <Clip label="shader" duration={seconds(3)}>
          <Background />
        </Clip>
        <Clip label="shapes" duration={seconds(5)}>
          <Shapes />
        </Clip>
        <Clip label="materials" duration={seconds(5)}>
          <Materials />
        </Clip>
      </Sequence>
    </Timeline>
  )
}

/** A background drawn by plasma.wgsl, with a title over it. */
function Background() {
  return (
    <Shader
      wgsl={plasma}
      uniforms={{ low: "#0f172a", high: "#7c3aed", speed: 0.8 }}
      style={{ ...FULL, display: "flex", justifyContent: "center", alignItems: "center" }}
    >
      <text style={{ color: "#f8fafc", fontSize: 120, fontWeight: "bold" }}>WGSL</text>
    </Shader>
  )
}

/** Shapes on a floor, seen by a camera that goes round them. */
function Shapes() {
  const frame = useCurrentFrame()
  const lift = useVariable({ x: 0, y: -1.5, z: 0 })
  useAnimation(async (ctx) => {
    await ctx.move(lift).to({ x: 0, y: 0.75, z: 0 }, seconds(1), BEZIER_SMOOTH)
  })
  return (
    <Scene3D style={FULL} background="#0b1020">
      <PerspectiveCamera position={() => orbit({ radius: 7, angle: 20 + frame() * 0.3, height: 3 })} lookAt={[0, 0.5, 0]} fov={45} />
      <HemisphereLight color="#bfdbfe" groundColor="#1e293b" intensity={0.4} />
      <DirectionalLight position={[4, 6, 3]} intensity={1.2} />
      <PointLight position={[-2, 1.5, 2]} color="#f472b6" intensity={3} range={6} />

      <Plane size={20} rotation={[-90, 0, 0]} material={{ color: "#1e293b", roughness: 0.9 }} />
      <Box
        size={1.5}
        position={lift}
        rotation={() => [0, frame() * 1.5, 0]}
        material={{ color: "#38bdf8", roughness: 0.35 }}
      />
      <Sphere position={[-2.5, 0.8, -0.5]} radius={0.8} material={{ color: "#e2e8f0", metalness: 1, roughness: 0.2 }} />
      <Group position={[2.5, 0.9, -0.5]} rotation={() => [frame() * 2, frame(), 0]}>
        <Torus radius={0.6} tube={0.22} material={{ color: "#f59e0b", roughness: 0.4 }} />
      </Group>
      <Cone position={[0.5, 0.6, 2.2]} radius={0.5} height={1.2} material={{ color: "#22c55e" }} />

      <text style={{ position: "absolute", left: 64, top: 48, color: "#e2e8f0", fontSize: 48 }}>Scene3D</text>
    </Scene3D>
  )
}

/** Materials written in WGSL: a hologram and a flag. */
function Materials() {
  const frame = useCurrentFrame()
  return (
    <Scene3D style={FULL} background="#020617">
      <PerspectiveCamera position={[0, 0.5, 6]} lookAt={[0, 0, 0]} fov={40} />
      <AmbientLight intensity={0.15} />
      <DirectionalLight position={[-3, 4, 5]} intensity={1.2} />

      <Sphere
        position={[-1.6, 0, 0]}
        radius={1.2}
        rotation={() => [0, frame(), 0]}
        material={{ wgsl: hologram, uniforms: { tint: "#22d3ee" }, transparent: true, doubleSided: true }}
      />
      <Group position={[0.6, 0, 0]}>
        <Plane
          size={[2.4, 1.6]}
          segments={[48, 1]}
          position={[1.2, 0.6, 0]}
          material={{
            wgsl: flag,
            uniforms: { height: 0.08 },
            color: "#ef4444",
            roughness: 0.6,
            doubleSided: true,
          }}
        />
        <Box size={[0.08, 3.2, 0.08]} position={[-0.04, -0.2, 0]} material={{ color: "#cbd5e1", metalness: 1, roughness: 0.3 }} />
      </Group>
    </Scene3D>
  )
}
