import { useAnimation, useVariable } from "../src/lib/animation"
import { BEZIER_SMOOTH } from "../src/lib/animation/functions"
import { Clip } from "../src/lib/clip"
import { seconds } from "../src/lib/frame"
import { FillFrame } from "../src/lib/layout/fill-frame"
import { Project, type ProjectSettings } from "../src/lib/project"
import { TimeLine } from "../src/lib/timeline"
import {
  THREE,
  ThreeCanvas,
  disposeThreeObject,
} from "../src/lib/webgl/three"

export const PROJECT_SETTINGS: ProjectSettings = {
  name: "framescript-template",
  width: 1920,
  height: 1080,
  fps: 60,
}

const CubeScene = () => {
  const rotationY = useVariable(0)
  const rotationX = useVariable(0)
  const positionX = useVariable(0)
  const scale = useVariable(1)

  useAnimation(async (context) => {
    await context.parallel([
      context.move(rotationY).to(Math.PI * 2, seconds(4), BEZIER_SMOOTH),
      context.move(positionX).to(2, seconds(2), BEZIER_SMOOTH),
    ])
    await context.parallel([
      context.move(positionX).to(-2, seconds(2), BEZIER_SMOOTH),
      context.move(rotationX).to(Math.PI, seconds(2), BEZIER_SMOOTH),
    ])
    await context.parallel([
      context.move(positionX).to(0, seconds(2), BEZIER_SMOOTH),
      context.move(scale).to(1.5, seconds(1), BEZIER_SMOOTH),
      context
        .move(rotationY)
        .to(Math.PI * 4, seconds(2), BEZIER_SMOOTH),
    ])
    await context.move(scale).to(1, seconds(2), BEZIER_SMOOTH)
  }, [])

  return (
    <FillFrame style={{ backgroundColor: "#000000" }}>
      <ThreeCanvas
        clearColor={0x000000}
        clearAlpha={1}
        setup={({ size }) => {
          const scene = new THREE.Scene()
          const camera = new THREE.PerspectiveCamera(
            45,
            size.cssWidth / size.cssHeight,
            0.1,
            100,
          )
          camera.position.set(0, 0, 6)

          const ambient = new THREE.AmbientLight(0xffffff, 0.4)
          scene.add(ambient)

          const directional = new THREE.DirectionalLight(0xffffff, 1.0)
          directional.position.set(3, 4, 5)
          scene.add(directional)

          const cube = new THREE.Mesh(
            new THREE.BoxGeometry(1.5, 1.5, 1.5),
            new THREE.MeshStandardMaterial({ color: 0x2266ff }),
          )
          scene.add(cube)

          return {
            scene,
            camera,
            update: ({ frame }) => {
              cube.rotation.y = rotationY.get(frame)
              cube.rotation.x = rotationX.get(frame)
              cube.position.x = positionX.get(frame)
              const s = scale.get(frame)
              cube.scale.set(s, s, s)
            },
            dispose: () => disposeThreeObject(cube),
          }
        }}
      />
    </FillFrame>
  )
}

export const PROJECT = () => {
  return (
    <Project>
      <TimeLine>
        <Clip label="Cube">
          <CubeScene />
        </Clip>
      </TimeLine>
    </Project>
  )
}
