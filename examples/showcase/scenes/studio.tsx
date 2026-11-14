// A torus knot whose color turns with the angle it is seen at, and eight balls of other materials
// round it, under a spot that casts their shadows.
import { BEZIER_EASE_IN_OUT, BEZIER_OVERSHOOT_SOFT, For, seconds, useAnimation, useCurrentFrame, useVariable } from "framescript"
import {
  Cylinder,
  DirectionalLight,
  HemisphereLight,
  type Material,
  Mesh,
  orbit,
  PerspectiveCamera,
  Plane,
  PointLight,
  Scene3D,
  Sphere,
  SpotLight,
} from "framescript/3d"
import { useThump } from "../beat.ts"
import { Caption, finish, FULL } from "../common.tsx"
import { torusKnot } from "../geometry.ts"
import ground from "../shaders/ground.wgsl"
import pearl from "../shaders/pearl.wgsl"

const KNOT = torusKnot(1.0, 0.3)

const BALLS: Material[] = [
  { color: "#ffcf6b", metalness: 1, roughness: 0.25 },
  { color: "#0e7490", emissive: "#22d3ee", emissiveIntensity: 2.5, roughness: 0.4 },
  { color: "#e5e7eb", metalness: 1, roughness: 0.06 },
  { color: "#f8fafc", roughness: 0.15 },
  { color: "#bae6fd", opacity: 0.3, transparent: true, roughness: 0.05 },
  { color: "#f59e6b", metalness: 1, roughness: 0.35 },
  { color: "#701a75", emissive: "#f472b6", emissiveIntensity: 2.5, roughness: 0.4 },
  { color: "#0a0a0a", roughness: 0.05 },
]

export function StudioScene() {
  const frame = useCurrentFrame()
  const thump = useThump()
  const grow = useVariable(0)
  const view = useVariable({ x: 8.5, y: 2.6, z: 15 })
  useAnimation(async (ctx) => {
    ctx.move(view).to({ x: 6.4, y: 1.7, z: 75 }, seconds(8), BEZIER_EASE_IN_OUT)
    await ctx.move(grow).to(1, seconds(1.2), BEZIER_OVERSHOOT_SOFT)
  })
  // x: the distance, y: the height, z: the angle.
  const eye = () => orbit({ radius: view().x, angle: view().z, height: view().y })

  return (
    <Scene3D style={FULL} background="#06070b" effects={finish({ bloom: 0.8, threshold: 0.8 })}>
      <PerspectiveCamera position={eye} lookAt={[0, 1.25, 0]} fov={38} />
      <HemisphereLight color="#94a3b8" groundColor="#0f172a" intensity={0.25} />
      <SpotLight position={[2.5, 7.5, 3.5]} lookAt={[0, 1, 0]} intensity={75} angle={34} penumbra={0.6} castShadow />
      <PointLight position={[-4, 3.5, -3]} color="#22d3ee" intensity={() => 9 + thump() * 10} range={14} />
      <PointLight position={[4, 1.5, -3]} color="#e879f9" intensity={() => 9 + thump() * 10} range={14} />
      <DirectionalLight position={[0, 4, -6]} color="#c7d2fe" intensity={0.7} />

      {/* The floor fades into the dark at its edges. */}
      <Plane
        size={200}
        rotation={[-90, 0, 0]}
        material={{ wgsl: ground, color: "#0d0f14", roughness: 0.5, uniforms: { line: "#000000", haze: "#06070b", speed: 0, far: 22 } }}
      />
      <Cylinder position={[0, 0.06, 0]} radius={1.7} height={0.12} segments={96} material={{ color: "#16181f", roughness: 0.35, metalness: 0.3 }} />

      <Mesh
        geometry={KNOT}
        position={() => [0, 1.65 + Math.sin(frame() / 40) * 0.08, 0]}
        rotation={() => [frame() * 0.35, frame() * 0.55, 0]}
        scale={() => grow() * 0.95}
        material={{ wgsl: pearl, uniforms: { shift: () => frame() / 500, metalness: 0.55, roughness: 0.2 } }}
      />

      <For each={BALLS}>
        {(material, i) => (
          <Sphere
            radius={0.34}
            position={() => {
              const [x, , z] = orbit({ radius: 2.75, angle: i * 45 + frame() * 0.45 })
              return [x, 0.5 + Math.sin(frame() / 25 + i) * 0.08 + thump() * 0.06, z]
            }}
            scale={() => Math.min(1, Math.max(0, grow() * 1.6 - i * 0.08))}
            material={material}
          />
        )}
      </For>

      <Caption
        index="02"
        label="LIGHT & MATERIAL"
        title="Physically based, with real shadows."
        body="PBR, soft shadows and bloom, and a surface written in WGSL."
        from={seconds(1.2)}
        to={seconds(8)}
      />
    </Scene3D>
  )
}
