// Rings round a light in deep space, the name, and what it was all made with.
import { BEZIER_EASE_IN_OUT, BEZIER_SMOOTH, seconds, useAnimation, useCurrentFrame, useVariable } from "framescript"
import { DirectionalLight, Group, HemisphereLight, PerspectiveCamera, PointLight, Scene3D, Sphere, Torus } from "framescript/3d"
import { useThump } from "../beat.ts"
import { finish, FULL, MONO, Rise, SANS } from "../common.tsx"
import pearl from "../shaders/pearl.wgsl"
import space from "../shaders/space.wgsl"

export function OutroScene() {
  const frame = useCurrentFrame()
  const thump = useThump()
  const open = useVariable(0)
  const title = useVariable(0)
  const line = useVariable(0)
  const credit = useVariable(0)
  const distance = useVariable(9)
  useAnimation(async (ctx) => {
    ctx.move(distance).to(6.2, seconds(6), BEZIER_EASE_IN_OUT)
    ctx.move(open).to(1, seconds(1.6), BEZIER_SMOOTH)
    await ctx.sleep(seconds(0.5))
    await ctx.move(title).to(1, seconds(1.2), BEZIER_SMOOTH)
    await ctx.move(line).to(1, seconds(0.7), BEZIER_SMOOTH)
    await ctx.move(credit).to(1, seconds(0.8), BEZIER_SMOOTH)
  })
  const spin = (k: number) => () => frame() * k

  return (
    <Scene3D style={FULL} background="#020108" effects={finish({ bloom: 1.0, threshold: 0.75 })}>
      <PerspectiveCamera position={() => [0, 0.2, distance()]} lookAt={[0, -0.55, 0]} fov={40} />
      <HemisphereLight color="#a5b4fc" groundColor="#020617" intensity={0.3} />
      <DirectionalLight position={[3, 4, 5]} intensity={1.1} />
      <PointLight position={[0, 0.6, 0]} color="#67e8f9" intensity={() => 6 + thump() * 20} range={8} />

      <Sphere
        radius={400}
        castShadow={false}
        receiveShadow={false}
        material={{ wgsl: space, doubleSided: true, uniforms: { deep: "#020108", glow: "#2a1b6e", hot: "#0891b2", brightness: 0.7 } }}
      />

      <Group position={[0, 0.6, 0]} scale={() => 0.2 + open() * 0.8}>
        <Sphere radius={0.32} material={{ color: "#000000", emissive: "#a5f3fc", emissiveIntensity: () => 3 + thump() * 6 }} />
        <Group rotation={() => [70 + spin(0.3)(), spin(0.9)(), 0]}>
          <Torus radius={1.45} tube={0.05} segments={[16, 160]} material={{ color: "#ffcf6b", metalness: 1, roughness: 0.2 }} />
        </Group>
        <Group rotation={() => [spin(-0.7)(), 30, spin(0.4)()]}>
          <Torus radius={1.15} tube={0.06} segments={[16, 160]} material={{ wgsl: pearl, uniforms: { shift: () => frame() / 300, metalness: 0.7, roughness: 0.15 } }} />
        </Group>
        <Group rotation={() => [spin(0.5)(), spin(-1.1)(), 60]}>
          <Torus radius={0.85} tube={0.045} segments={[16, 128]} material={{ color: "#e5e7eb", metalness: 1, roughness: 0.08 }} />
        </Group>
      </Group>

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 150,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 18,
        }}
      >
        <Rise text="FrameScript2" progress={title} spread={0.55} style={{ fontFamily: SANS, fontSize: 120, fontWeight: "bold", color: "#f8fafc" }} />
        <text
          style={{
            fontFamily: MONO,
            fontSize: 26,
            letterSpacing: () => 14 - line() * 6,
            color: "#a5f3fc",
            opacity: line,
          }}
        >
          TSX · deno_core · AntiWebUI · wgpu
        </text>
      </div>
      <text
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 56,
          textAlign: "center",
          fontFamily: SANS,
          fontSize: 20,
          color: "#94a3b8",
          opacity: credit,
        }}
      >
        Pictures and music made from code in examples/showcase. Fox by PixelMannen and tomkranis, CC BY 4.0.
      </text>
    </Scene3D>
  )
}
