// A city of 2,304 columns in one mesh, moved by its WGSL to the beat, seen by a camera that dives
// into it from above and glides on.
import { BEZIER_EASE_IN_OUT, BEZIER_SMOOTH, seconds, useAnimation, useCurrentFrame, useVariable } from "framescript"
import { Mesh, PerspectiveCamera, Plane, Scene3D, HemisphereLight, DirectionalLight } from "framescript/3d"
import { useKick } from "../beat.ts"
import { Caption, finish, FULL } from "../common.tsx"
import { columns } from "../geometry.ts"
import city from "../shaders/city.wgsl"
import ground from "../shaders/ground.wgsl"

export const GRID = 48
const COLUMNS = columns(GRID, 0.5, 0.4)
export const FOG = "#070a1c"

/** The columns, and the floor they stand on. */
export function City(props: { energy?: () => number; kick: () => number }) {
  return (
    <>
      <Mesh
        geometry={COLUMNS}
        castShadow={false}
        material={{
          wgsl: city,
          uniforms: {
            low: "#1d4ed8",
            high: "#f0abfc",
            body: "#0b1020",
            fog: FOG,
            kick: props.kick,
            energy: props.energy ?? 1,
            grid: GRID,
            far: 26,
          },
        }}
      />
      {/* The floor fades into the fog as the columns do. */}
      <Plane
        size={200}
        rotation={[-90, 0, 0]}
        material={{ wgsl: ground, uniforms: { line: "#000000", haze: FOG, speed: 0, far: 26 }, color: "#03040a" }}
      />
    </>
  )
}

export function CityScene() {
  const kick = useKick()
  const frame = useCurrentFrame()
  const eye = useVariable({ x: 2, y: 22, z: 10 })
  const target = useVariable({ x: 0, y: 0, z: 0 })
  useAnimation(async (ctx) => {
    await ctx.parallel([
      ctx.move(eye).to({ x: -3, y: 3.2, z: 9 }, seconds(3.2), BEZIER_SMOOTH),
      ctx.move(target).to({ x: 0, y: 0.8, z: 0 }, seconds(3.2), BEZIER_SMOOTH),
    ])
    await ctx.parallel([
      ctx.move(eye).to({ x: 3, y: 3.4, z: 2 }, seconds(4.8), BEZIER_EASE_IN_OUT),
      ctx.move(target).to({ x: -3, y: 0.6, z: -8 }, seconds(4.8), BEZIER_EASE_IN_OUT),
    ])
  })
  return (
    <Scene3D style={FULL} background={FOG} effects={finish({ bloom: 1.1, threshold: 0.6 })}>
      <PerspectiveCamera position={eye} lookAt={target} fov={() => 50 + Math.sin(frame() / 70) * 2} />
      <HemisphereLight color="#6366f1" groundColor="#020617" intensity={0.25} />
      <DirectionalLight position={[-4, 8, 6]} color="#c7d2fe" intensity={0.6} />
      <City kick={kick} />
      <Caption
        index="01"
        label="WGSL MATERIALS"
        title="2,304 columns. One mesh."
        body="Each one raised by a vertex shader, in time with the beat."
        from={seconds(1.6)}
        to={seconds(8)}
      />
    </Scene3D>
  )
}
