// A fox that runs into the sunset over a floor of lines that runs past it, by signs of 2D in the
// scene that tell what FrameScript2 is made of.
import { For, framesToSeconds, seconds, useCurrentFrame } from "framescript"
import { DirectionalLight, HemisphereLight, Model, Panel, PerspectiveCamera, Plane, Scene3D, Sphere } from "framescript/3d"
import { Caption, finish, FULL, MONO, SANS } from "../common.tsx"
import ground from "../shaders/ground.wgsl"
import sunset from "../shaders/sunset.wgsl"

/** Units a second: as fast as the fox's legs go. */
const SPEED = 3.1
const HORIZON = "#f9735b"

const SIGNS = [
  { name: "deno_core", what: "TSX runs in V8. No browser.", color: "#f472b6" },
  { name: "AntiWebUI", what: "Its own layout and paint, on wgpu.", color: "#38bdf8" },
  { name: "Export", what: "Frames drawn on many threads at once.", color: "#facc15" },
]

/** Bits of light in the air, where they start, in the frame of the floor. */
const MOTES = Array.from({ length: 24 }, (_, i) => {
  const r = (n: number) => (Math.sin(i * 91.7 + n * 13.1) * 43758.5453) % 1
  return { x: Math.abs(r(1)) * 40 - 8, y: 0.3 + Math.abs(r(2)) * 2.2, z: -6 + Math.abs(r(3)) * 9, s: 0.015 + Math.abs(r(4)) * 0.025 }
})

export function RunScene() {
  const frame = useCurrentFrame()
  const t = () => framesToSeconds(frame())
  /** Where something at `x` on the floor is now. */
  const past = (x: number) => x - t() * SPEED

  return (
    <Scene3D style={FULL} background={HORIZON} effects={finish({ bloom: 0.7, threshold: 0.85 })}>
      <PerspectiveCamera
        position={() => [2.6 - t() * 0.2, 0.95 + Math.sin(t() * 9.5) * 0.02, 7.6 - t() * 0.3]}
        lookAt={[0.9, 0.95, 0]}
        fov={34}
      />
      <HemisphereLight color="#a78bfa" groundColor="#2a1636" intensity={0.55} />
      <DirectionalLight position={[-3.5, 0.9, -10]} color="#ffc38a" intensity={2.4} castShadow />
      <DirectionalLight position={[4, 5, 6]} color="#c4b5fd" intensity={0.45} />

      <Sphere
        radius={300}
        castShadow={false}
        receiveShadow={false}
        material={{
          wgsl: sunset,
          doubleSided: true,
          uniforms: {
            zenith: "#1a1446",
            horizon: HORIZON,
            sun_color: "#ffd38a",
            near_hills: "#1e1233",
            far_hills: "#5b2c63",
            sun: [-0.33, 0.07, -1],
          },
        }}
      />
      <Plane
        size={400}
        rotation={[-90, 0, 0]}
        material={{
          wgsl: ground,
          color: "#160b24",
          roughness: 0.5,
          uniforms: { line: "#ff6fb5", haze: "#c2477a", speed: SPEED, far: 70 },
        }}
      />

      <Model src="assets/Fox.glb" scale={0.02} rotation={[0, 90, 0]} animation="Run" speed={1.15} />

      <For each={SIGNS}>
        {(sign, i) => (
          <Panel position={() => [past(7 + i * 6.4), 1.9, -4.5]} pixelsPerUnit={200}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: "26px 34px",
                borderRadius: 26,
                background: "rgba(14, 8, 28, 0.82)",
                border: `3px solid ${sign.color}`,
              }}
            >
              <text style={{ fontFamily: MONO, fontSize: 22, letterSpacing: 4, color: sign.color }}>{`0${i + 1}`}</text>
              <text style={{ fontFamily: SANS, fontSize: 54, fontWeight: "bold", color: "#fff7ed" }}>{sign.name}</text>
              <text style={{ fontFamily: SANS, fontSize: 26, color: "#e9d5ff" }}>{sign.what}</text>
            </div>
          </Panel>
        )}
      </For>

      <For each={MOTES}>
        {(m) => (
          <Sphere
            radius={m.s}
            position={() => [((past(m.x) % 40) + 40) % 40 - 12, m.y + Math.sin(t() * 2 + m.x) * 0.1, m.z]}
            castShadow={false}
            material={{ color: "#000000", emissive: "#ffd9a0", emissiveIntensity: 6 }}
          />
        )}
      </For>

      <Caption
        index="03"
        label="glTF MODELS"
        title="Skinned, animated, on time."
        body="A glTF fox, and signs of plain 2D placed in the scene."
        from={seconds(0.8)}
        to={seconds(6)}
      />
    </Scene3D>
  )
}
