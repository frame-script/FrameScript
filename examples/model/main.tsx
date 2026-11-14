// A glTF model: a fox that looks about, walks, then runs round, with its shadow. Run
// ./get-assets.sh first: it fetches assets/Fox.glb (CC BY 4.0, see there).
import { Clip, seconds, Sequence, Timeline, useCurrentFrame } from "framescript"
import { DirectionalLight, HemisphereLight, Model, orbit, PerspectiveCamera, Plane, Scene3D } from "framescript/3d"

const FOX = "assets/Fox.glb"

export default function Main() {
  const frame = useCurrentFrame()
  return (
    <Scene3D style={{ width: "100%", height: "100%" }} background="#cbd5e1">
      <PerspectiveCamera position={() => orbit({ radius: 5, angle: 30 + frame() * 0.1, height: 2 })} lookAt={[0, 0.7, 0]} fov={40} />
      <HemisphereLight color="#ffffff" groundColor="#94a3b8" intensity={0.5} />
      <DirectionalLight position={[3, 6, 2]} intensity={1.2} castShadow />
      <Plane size={20} rotation={[-90, 0, 0]} material={{ color: "#e2e8f0" }} />
      {/* The model is in centimetres. */}
      <Timeline>
        <Sequence>
          <Clip label="survey" duration={seconds(3.4)}>
            <Model src={FOX} scale={0.02} animation="Survey" />
          </Clip>
          <Clip label="walk" duration={seconds(3)}>
            <Model src={FOX} scale={0.02} animation="Walk" />
          </Clip>
          <Clip label="run" duration={seconds(4)}>
            <Running />
          </Clip>
        </Sequence>
      </Timeline>
      <text style={{ position: "absolute", left: 64, top: 48, color: "#334155", fontSize: 48 }}>glTF</text>
    </Scene3D>
  )
}

/** Round a circle of 1.5 units, a turn every 3 seconds, facing the way it goes. */
function Running() {
  const frame = useCurrentFrame()
  const angle = () => (frame() / seconds(3)) * 360
  return (
    <Model
      src={FOX}
      scale={0.02}
      animation="Run"
      position={() => orbit({ radius: 1.5, angle: angle() })}
      rotation={() => [0, angle() + 90, 0]}
    />
  )
}
