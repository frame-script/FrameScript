//! `<Shader>` and `<Scene3D>` through the real renderer: what WGSL is given arrives, the time is that
//! of the clip, what is wrong is said where it is, things in 3D go where they are put and come and go
//! with their clips, and a frame is the same whichever came before it. Skipped without a GPU.

use framescript_engine::Composition;
use framescript_engine::render::OffscreenRenderer;
use std::path::PathBuf;

const W: u32 = 64;
const H: u32 = 48;

/// A project of 64 by 48 at 30 fps, whose main.tsx is `main` and which has the files `files`.
fn project(name: &str, main: &str, files: &[(&str, &str)]) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("framescript-gpu-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("framescript.json"),
        format!(r##"{{ "width": {W}, "height": {H}, "fps": 30, "entry": "main.tsx", "duration": 2, "background": "#000000" }}"##),
    )
    .unwrap();
    std::fs::write(dir.join("main.tsx"), main).unwrap();
    for (name, code) in files {
        std::fs::write(dir.join(name), code).unwrap();
    }
    dir
}

fn gpu() -> Option<OffscreenRenderer> {
    match OffscreenRenderer::new() {
        Ok(g) => Some(g),
        Err(e) => {
            eprintln!("no GPU ({e}); skipped");
            None
        }
    }
}

fn px(p: &[u8], x: u32, y: u32) -> [u8; 4] {
    let i = ((y * W + x) * 4) as usize;
    [p[i], p[i + 1], p[i + 2], p[i + 3]]
}

fn close(a: [u8; 4], b: [u8; 4]) -> bool {
    a.iter().zip(b).all(|(x, y)| x.abs_diff(y) <= 1)
}

fn frame(c: &mut Composition, gpu: &mut OffscreenRenderer, f: u32) -> Vec<u8> {
    gpu.rgba(&c.render(f).expect("renders").0)
}

#[test]
fn a_shader_is_given_its_uniforms_and_the_time_of_its_clip() {
    let Some(mut gpu) = gpu() else { return };
    let wgsl = r#"
struct Uniforms { color: vec4f, level: f32 }
@group(1) @binding(0) var<uniform> u: Uniforms;
fn shade(uv: vec2f) -> vec4f {
    // The left half the color, the right half gray by the frame of the clip.
    if uv.x < 0.5 { return u.color; }
    let g = fs.frame / 30.0 * u.level;
    return vec4f(g, g, g, 1.0);
}
"#;
    let main = r##"import { Clip, Shader, useCurrentFrame } from "framescript"
import paint from "./paint.wgsl"
export default function Main() {
  const frame = useCurrentFrame()
  return (
    <Clip start={10} duration={30}>
      <Shader wgsl={paint} uniforms={{ color: "#3366cc", level: () => (frame() < 20 ? 1 : 0.5) }}
        style={{ width: "100%", height: "100%" }} />
    </Clip>
  )
}
"##;
    let dir = project("uniforms", main, &[("paint.wgsl", wgsl)]);
    let mut c = Composition::load(&dir).expect("loads");
    let gray = |light: f64| (255.0 * (1.055 * light.powf(1.0 / 2.4) - 0.055)).round() as u8;
    // A color in, as light, and out again as the color it was. Frame 5 of the clip (15 of the
    // composition, whose frame `level` reads): 5/30 of light, stored as sRGB.
    let p = frame(&mut c, &mut gpu, 15);
    assert!(close(px(&p, 10, 24), [0x33, 0x66, 0xcc, 255]), "{:?}", px(&p, 10, 24));
    let g = gray(5.0 / 30.0);
    assert!(close(px(&p, 50, 24), [g, g, g, 255]), "{:?}", px(&p, 50, 24));
    // A uniform that is a function follows: at frame 20 of the clip, half of 20/30.
    let p = frame(&mut c, &mut gpu, 30);
    let g = gray(1.0 / 3.0);
    assert!(close(px(&p, 50, 24), [g, g, g, 255]), "{:?}", px(&p, 50, 24));
    // Before the clip, nothing.
    let p = frame(&mut c, &mut gpu, 5);
    assert_eq!(px(&p, 10, 24), [0, 0, 0, 255]);
}

#[test]
fn what_is_wrong_with_wgsl_is_said_at_its_line() {
    let wgsl = "fn shade(uv: vec2f) -> vec4f {\n    return vec4f(uv, oops, 1.0);\n}\n";
    let main = r#"import { Shader } from "framescript"
import bad from "./bad.wgsl"
export default function Main() { return <Shader wgsl={bad} /> }
"#;
    let dir = project("wrong", main, &[("bad.wgsl", wgsl)]);
    let e = Composition::load(&dir).err().expect("it doesn't load").to_string();
    assert!(e.contains("bad.wgsl:2:"), "{e}");
    assert!(e.contains("oops"), "{e}");

    let wgsl = "struct U { color: vec4f }\n@group(1) @binding(0) var<uniform> u: U;\nfn shade(uv: vec2f) -> vec4f { return u.color; }\n";
    let main = r#"import { Shader } from "framescript"
import paint from "./paint.wgsl"
export default function Main() { return <Shader wgsl={paint} uniforms={{ colour: "red" }} /> }
"#;
    let dir = project("misnamed", main, &[("paint.wgsl", wgsl)]);
    let e = Composition::load(&dir).err().expect("it doesn't load").to_string();
    assert!(e.contains("uniforms.colour") && e.contains("did you mean color?"), "{e}");
}

/// A scene that is all of the frame, seen by an orthographic camera 4 units high from +Z, with
/// things drawn in one color whatever the light (a `fragment` of their own).
fn flat_scene(things: &str) -> String {
    format!(
        r##"import {{ Clip }} from "framescript"
import {{ Box, Group, OrthographicCamera, Plane, Scene3D }} from "framescript/3d"
import flat from "./flat.wgsl"
const red = {{ wgsl: flat, uniforms: {{ color: "#ff0000" }} }}
const blue = {{ wgsl: flat, uniforms: {{ color: "#0000ff" }} }}
export default function Main() {{
  return (
    <Scene3D style={{{{ width: "100%", height: "100%" }}}} background="#00ff00">
      <OrthographicCamera position={{[0, 0, 10]}} height={{4}} />
      {things}
    </Scene3D>
  )
}}
"##
    )
}

const FLAT: &str = r#"
struct U { color: vec4f }
@group(1) @binding(0) var<uniform> u: U;
fn fragment(in: SurfaceInput) -> vec4f { return u.color; }
"#;

#[test]
fn things_in_3d_are_where_they_are_put_and_in_front_of_what_is_behind_them() {
    let Some(mut gpu) = gpu() else { return };
    // 64 by 48 pixels see 16/3 by 4 units: 12 pixels to a unit. A red plane over all of it at the
    // back, a blue box of 1 unit at (1, 1), in front.
    let main = flat_scene(
        r#"<Plane size={[4, 2]} position={[0, 0, -1]} material={red} />
      <Group position={[1, 1, 0]}><Box size={1} material={blue} /></Group>"#,
    );
    let dir = project("place", &main, &[("flat.wgsl", FLAT)]);
    let mut c = Composition::load(&dir).expect("loads");
    let p = frame(&mut c, &mut gpu, 0);
    assert_eq!(px(&p, 2, 2), [0, 255, 0, 255], "the background, where there is nothing");
    assert_eq!(px(&p, 32, 30), [255, 0, 0, 255], "the plane");
    // The middle of the box: 12 pixels right of the middle and 12 up.
    assert_eq!(px(&p, 44, 12), [0, 0, 255, 255], "the box, in front of the plane");
    assert_eq!(px(&p, 44, 20), [255, 0, 0, 255], "below the box, the plane again");
}

#[test]
fn clips_in_a_scene_come_and_go_with_their_time() {
    let Some(mut gpu) = gpu() else { return };
    let main = flat_scene(
        r#"<Clip start={0} duration={10}><Plane size={10} material={red} /></Clip>
      <Clip start={10} duration={10}><Plane size={10} material={blue} /></Clip>"#,
    );
    let dir = project("clips", &main, &[("flat.wgsl", FLAT)]);
    let mut c = Composition::load(&dir).expect("loads");
    let middle = |p: &[u8]| px(p, 32, 24);
    assert_eq!(middle(&frame(&mut c, &mut gpu, 15)), [0, 0, 255, 255]);
    assert_eq!(middle(&frame(&mut c, &mut gpu, 5)), [255, 0, 0, 255]);
    assert_eq!(middle(&frame(&mut c, &mut gpu, 25)), [0, 255, 0, 255], "after both");
}

#[test]
fn an_empty_scene_is_its_background() {
    let Some(mut gpu) = gpu() else { return };
    let main = r##"import { Scene3D } from "framescript/3d"
export default function Main() { return <Scene3D style={{ width: "100%", height: "100%" }} background="#0000ff" /> }
"##;
    let dir = project("empty", main, &[]);
    let mut c = Composition::load(&dir).expect("loads");
    assert_eq!(px(&frame(&mut c, &mut gpu, 0), 32, 24), [0, 0, 255, 255]);
}

#[test]
fn a_thing_in_3d_out_of_a_scene_is_refused() {
    let main = r#"import { Box } from "framescript/3d"
export default function Main() { return <div><Box /></div> }
"#;
    let dir = project("outside", main, &[]);
    let e = Composition::load(&dir).err().expect("it doesn't load").to_string();
    assert!(e.contains("<Scene3D>"), "{e}");
}

#[test]
fn a_lit_scene_is_the_same_whatever_frame_came_before() {
    let Some(mut gpu) = gpu() else { return };
    let project = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../examples/3d"));
    let mut c = Composition::load(&project).expect("the example loads");
    c.fit(320, 180);
    let frames = [200, 650, 300, 420, 760];
    let forwards: Vec<_> = frames.iter().map(|&f| frame_any(&mut c, &mut gpu, f)).collect();
    let mut c = Composition::load(&project).expect("the example loads");
    c.fit(320, 180);
    for (i, &f) in frames.iter().enumerate().rev() {
        assert!(frame_any(&mut c, &mut gpu, f) == forwards[i], "frame {f} differs when reached another way");
    }
    // Lit, and moving: the frames aren't alike.
    assert!(forwards.windows(2).all(|w| w[0] != w[1]));
    // Something other than the background is drawn in the middle of a frame of shapes.
    let p = &forwards[0];
    let at = |x: u32, y: u32| {
        let i = ((y * 320 + x) * 4) as usize;
        [p[i], p[i + 1], p[i + 2]]
    };
    assert_ne!(at(160, 90), at(10, 10));
}

fn frame_any(c: &mut Composition, gpu: &mut OffscreenRenderer, f: u32) -> Vec<u8> {
    gpu.rgba(&c.render(f).expect("renders").0)
}

/// A picture of two pixels: red on the left, blue on the right.
fn two_pixels(path: &std::path::Path) {
    let file = std::fs::File::create(path).unwrap();
    let mut e = png::Encoder::new(std::io::BufWriter::new(file), 2, 1);
    e.set_color(png::ColorType::Rgba);
    e.set_depth(png::BitDepth::Eight);
    e.write_header().unwrap().write_image_data(&[255, 0, 0, 255, 0, 0, 255, 255]).unwrap();
}

#[test]
fn pictures_are_given_to_shaders_and_materials() {
    let Some(mut gpu) = gpu() else { return };
    let wgsl = r#"
@group(1) @binding(0) var picture: texture_2d<f32>;
@group(1) @binding(1) var nearest: sampler;
fn fragment(in: SurfaceInput) -> vec4f {
    // The texel itself, not a mix of the two.
    return textureLoad(picture, vec2i(select(0, 1, in.uv.x > 0.5), 0), 0);
}
"#;
    let main = r##"import { OrthographicCamera, Plane, Scene3D } from "framescript/3d"
import show from "./show.wgsl"
export default function Main() {
  return (
    <Scene3D style={{ width: "100%", height: "100%" }}>
      <OrthographicCamera position={[0, 0, 10]} height={4} />
      <Plane size={[4, 2]} position={[0, 1, 0]} material={{ wgsl: show, textures: { picture: "two.png" } }} />
      <Plane size={[4, 2]} position={[0, -1, 0]} material={{ map: "two.png" }} />
    </Scene3D>
  )
}
"##;
    let dir = project("pictures", main, &[("show.wgsl", wgsl)]);
    two_pixels(&dir.join("two.png"));
    let mut c = Composition::load(&dir).expect("loads");
    let p = frame(&mut c, &mut gpu, 0);
    assert_eq!(px(&p, 20, 12), [255, 0, 0, 255], "the left of the picture");
    assert_eq!(px(&p, 44, 12), [0, 0, 255, 255], "its right");
    // Lit, so not the colors themselves, but red to the left and blue to the right.
    let (left, right) = (px(&p, 10, 36), px(&p, 54, 36));
    assert!(left[0] > 100 && left[2] < 60, "{left:?}");
    assert!(right[2] > 100 && right[0] < 60, "{right:?}");
}

/// Seen from above: a floor, a box hanging over its middle, and a light from the side at 45°, so
/// that the box's shadow falls 1.5 units to one side of the middle and nothing to the other.
/// Returns how bright the floor is on each side.
fn shadow_sides(name: &str, light: &str, floor: &str) -> Option<(u8, u8)> {
    let mut gpu = gpu()?;
    let main = format!(
        r##"import {{ Box, DirectionalLight, OrthographicCamera, Plane, Scene3D }} from "framescript/3d"
export default function Main() {{
  return (
    <Scene3D style={{{{ width: "100%", height: "100%" }}}}>
      <OrthographicCamera position={{[0, 10, 0]}} lookAt={{[0, 0, 0]}} height={{4}} />
      <DirectionalLight position={{[1, 1, 0]}} {light} />
      <Plane size={{10}} rotation={{[-90, 0, 0]}} material={{{{ color: "#ffffff" }}}} {floor} />
      <Box size={{1}} position={{[0, 1.5, 0]}} />
    </Scene3D>
  )
}}
"##
    );
    let dir = project(name, &main, &[]);
    let mut c = Composition::load(&dir).expect("loads");
    let p = frame(&mut c, &mut gpu, 0);
    // 12 pixels to a unit: 1.5 units to either side of the middle.
    Some((px(&p, 32 - 18, 24)[0], px(&p, 32 + 18, 24)[0]))
}

#[test]
fn what_casts_shadows_darkens_what_receives_them() {
    let Some((a, b)) = shadow_sides("shadow", "castShadow", "") else { return };
    let (dark, lit) = (a.min(b), a.max(b));
    assert!(lit > 200 && dark < lit / 2, "one side in the shadow: {a} and {b}");

    // Alike but for the highlight, which is seen from a point.
    let (a, b) = shadow_sides("no-shadow", "", "").unwrap();
    assert!(a.abs_diff(b) <= 4, "no shadows from a light that doesn't cast them: {a} and {b}");
    let (a, b) = shadow_sides("not-received", "castShadow", "receiveShadow={false}").unwrap();
    assert!(a.abs_diff(b) <= 4, "none on what doesn't receive them: {a} and {b}");
}

fn base64(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= c.len() {
                out.push(A[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// A red square 2 units across in the XY plane, facing +Z, with an animation "move" of a second
/// that takes `moved` (node 0, the square itself, or node 1, a joint the square is skinned to)
/// from where it is to `to`.
fn square_gltf(skinned: bool, to: [f32; 3]) -> String {
    let mut bin: Vec<u8> = Vec::new();
    let mut put = |floats: &[f32]| {
        let at = bin.len();
        for f in floats {
            bin.extend_from_slice(&f.to_le_bytes());
        }
        (at, bin.len() - at)
    };
    let positions = put(&[-1., -1., 0., 1., -1., 0., 1., 1., 0., -1., 1., 0.]);
    let normals = put(&[0., 0., 1., 0., 0., 1., 0., 0., 1., 0., 0., 1.]);
    let times = put(&[0., 1.]);
    let moves = put(&[0., 0., 0., to[0], to[1], to[2]]);
    let weights = put(&[1., 0., 0., 0., 1., 0., 0., 0., 1., 0., 0., 0., 1., 0., 0., 0.]);
    let indices = {
        let at = bin.len();
        for i in [0u16, 1, 2, 0, 2, 3, 0, 0] {
            bin.extend_from_slice(&i.to_le_bytes());
        }
        (at, 12)
    };
    let joints = {
        let at = bin.len();
        bin.extend_from_slice(&[0u8; 32]);
        (at, 32)
    };
    let view = |(at, len): (usize, usize)| format!(r#"{{ "buffer": 0, "byteOffset": {at}, "byteLength": {len} }}"#);
    let (skin, nodes, attributes, target) = if skinned {
        (
            r#", "skins": [{ "joints": [1] }]"#,
            r#"[{ "mesh": 0, "skin": 0 }, { "name": "joint" }]"#,
            r#", "JOINTS_0": 5, "WEIGHTS_0": 6"#,
            1,
        )
    } else {
        ("", r#"[{ "mesh": 0 }]"#, "", 0)
    };
    format!(
        r#"{{
  "asset": {{ "version": "2.0" }},
  "scene": 0,
  "scenes": [{{ "nodes": [{roots}] }}],
  "nodes": {nodes}{skin},
  "meshes": [{{ "primitives": [{{ "attributes": {{ "POSITION": 0, "NORMAL": 1{attributes} }}, "indices": 2, "material": 0 }}] }}],
  "materials": [{{ "pbrMetallicRoughness": {{ "baseColorFactor": [1, 0, 0, 1], "metallicFactor": 0, "roughnessFactor": 1 }} }}],
  "animations": [{{ "name": "move", "channels": [{{ "sampler": 0, "target": {{ "node": {target}, "path": "translation" }} }}],
                   "samplers": [{{ "input": 3, "output": 4, "interpolation": "LINEAR" }}] }}],
  "accessors": [
    {{ "bufferView": 0, "componentType": 5126, "count": 4, "type": "VEC3", "min": [-1, -1, 0], "max": [1, 1, 0] }},
    {{ "bufferView": 1, "componentType": 5126, "count": 4, "type": "VEC3" }},
    {{ "bufferView": 2, "componentType": 5123, "count": 6, "type": "SCALAR" }},
    {{ "bufferView": 3, "componentType": 5126, "count": 2, "type": "SCALAR", "min": [0], "max": [1] }},
    {{ "bufferView": 4, "componentType": 5126, "count": 2, "type": "VEC3" }},
    {{ "bufferView": 5, "componentType": 5123, "count": 4, "type": "VEC4" }},
    {{ "bufferView": 6, "componentType": 5126, "count": 4, "type": "VEC4" }}
  ],
  "bufferViews": [{}, {}, {}, {}, {}, {}, {}],
  "buffers": [{{ "byteLength": {len}, "uri": "data:application/octet-stream;base64,{data}" }}]
}}"#,
        view(positions),
        view(normals),
        view(indices),
        view(times),
        view(moves),
        view(joints),
        view(weights),
        roots = if skinned { "0, 1" } else { "0" },
        len = bin.len(),
        data = base64(&bin),
    )
}

/// Whether the model in `gltf` covers the points (in units) at frames 0 and 15, half a second in.
fn model_covers(name: &str, gltf: &str, points: &[(f32, f32)]) -> Option<Vec<[bool; 2]>> {
    let mut gpu = gpu()?;
    let main = r##"import { AmbientLight, Model, OrthographicCamera, Scene3D } from "framescript/3d"
export default function Main() {
  return (
    <Scene3D style={{ width: "100%", height: "100%" }} background="#00ff00">
      <OrthographicCamera position={[0, 0, 10]} height={4} />
      <AmbientLight intensity={1} />
      <Model src="square.gltf" animation="move" />
    </Scene3D>
  )
}
"##;
    let dir = project(name, main, &[("square.gltf", gltf)]);
    let mut c = Composition::load(&dir).expect("loads");
    let frames = [frame(&mut c, &mut gpu, 0), frame(&mut c, &mut gpu, 15)];
    let covered = |p: &[u8], (x, y): (f32, f32)| {
        let at = px(p, (32.0 + x * 12.0) as u32, (24.0 - y * 12.0) as u32);
        assert!(at == [0, 255, 0, 255] || (at[0] > 150 && at[1] < 80), "neither: {at:?}");
        at[0] > 150
    };
    Some(points.iter().map(|&q| [covered(&frames[0], q), covered(&frames[1], q)]).collect())
}

#[test]
fn a_model_is_where_its_animation_puts_it_at_the_time() {
    // Half a second in, it has gone 1 to the right.
    let Some(c) = model_covers("model", &square_gltf(false, [2.0, 0.0, 0.0]), &[(-0.75, 0.0), (1.5, 0.0)]) else {
        return;
    };
    assert_eq!(c, [[true, false], [false, true]]);
    // Its joint goes up, and the skin with it.
    let c = model_covers("skinned", &square_gltf(true, [0.0, 1.5, 0.0]), &[(0.0, -0.75), (0.0, 1.25)]).unwrap();
    assert_eq!(c, [[true, false], [false, true]]);
}

#[test]
fn an_animation_that_isnt_there_is_said_so() {
    let main = r#"import { Model, Scene3D } from "framescript/3d"
export default function Main() { return <Scene3D><Model src="square.gltf" animation="walk" /></Scene3D> }
"#;
    let dir = project("no-animation", main, &[("square.gltf", &square_gltf(false, [1.0, 0.0, 0.0]))]);
    let e = Composition::load(&dir).err().expect("it doesn't load").to_string();
    assert!(e.contains("no animation \"walk\"") && e.contains("it has move"), "{e}");
}

/// A video of 2 s at 30 fps: red for the first second, blue for the next. `None` without ffmpeg.
fn red_then_blue(dir: &std::path::Path) -> Option<()> {
    let made = std::process::Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=64x48:r=30:d=1", "-f", "lavfi"])
        .args(["-i", "color=c=blue:s=64x48:r=30:d=1", "-filter_complex", "[0][1]concat=n=2:v=1"])
        .args(["-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "15"])
        .arg(dir.join("rb.mp4"))
        .status()
        .is_ok_and(|s| s.success());
    if !made {
        eprintln!("no ffmpeg; skipped");
    }
    made.then_some(())
}

#[test]
fn videos_are_given_to_textures_frame_by_frame() {
    let Some(mut gpu) = gpu() else { return };
    let bindings = "@group(1) @binding(0) var picture: texture_2d<f32>;\n@group(1) @binding(1) var linear: sampler;\n";
    let flat = format!("{bindings}fn shade(uv: vec2f) -> vec4f {{ return textureSample(picture, linear, uv); }}");
    let unlit = format!("{bindings}fn fragment(in: SurfaceInput) -> vec4f {{ return textureSample(picture, linear, in.uv); }}");
    // The left half a <Shader> from the start; the right half a plane in a scene, in a clip that
    // starts at frame 30, so that its video is half a second in at frame 45.
    let main = r##"import { Clip, Shader } from "framescript"
import { OrthographicCamera, Plane, Scene3D } from "framescript/3d"
import flat from "./flat.wgsl"
import unlit from "./unlit.wgsl"
const video = { video: "rb.mp4", muted: true }
export default function Main() {
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "row" }}>
      <Shader wgsl={flat} textures={{ picture: video }} style={{ width: 32, height: 48 }} />
      <Scene3D style={{ width: 32, height: 48 }}>
        <OrthographicCamera position={[0, 0, 10]} height={4} />
        <Clip start={30} duration={60}>
          <Plane size={10} material={{ wgsl: unlit, textures: { picture: video } }} />
        </Clip>
      </Scene3D>
    </div>
  )
}
"##;
    let dir = project("video", main, &[("flat.wgsl", &flat), ("unlit.wgsl", &unlit)]);
    if red_then_blue(&dir).is_none() {
        return;
    }
    let mut c = Composition::load(&dir).expect("loads");
    let red = |p: [u8; 4]| p[0] > 200 && p[2] < 50;
    let blue = |p: [u8; 4]| p[2] > 200 && p[0] < 50;
    let p = frame(&mut c, &mut gpu, 15);
    assert!(red(px(&p, 16, 24)), "the box, half a second in: {:?}", px(&p, 16, 24));
    let p = frame(&mut c, &mut gpu, 45);
    assert!(blue(px(&p, 16, 24)), "the box, a second and a half in: {:?}", px(&p, 16, 24));
    assert!(red(px(&p, 48, 24)), "the plane, half a second into its clip: {:?}", px(&p, 48, 24));
    let p = frame(&mut c, &mut gpu, 75);
    assert!(blue(px(&p, 48, 24)), "the plane, later: {:?}", px(&p, 48, 24));
    // Back again.
    let p = frame(&mut c, &mut gpu, 15);
    assert!(red(px(&p, 16, 24)), "{:?}", px(&p, 16, 24));
}

#[test]
fn a_panel_shows_its_2d_in_the_scene_and_only_there() {
    let Some(mut gpu) = gpu() else { return };
    // 100 by 50 pixels at 25 to a unit: 4 by 2 units, 48 by 24 pixels of the frame, in the middle.
    let main = r##"import { useCurrentFrame } from "framescript"
import { OrthographicCamera, Panel, Scene3D } from "framescript/3d"
export default function Main() {
  const frame = useCurrentFrame()
  return (
    <Scene3D style={{ width: "100%", height: "100%" }} background="#00ff00">
      <OrthographicCamera position={[0, 0, 10]} height={4} />
      <Panel pixelsPerUnit={25}>
        <div style={{ width: 100, height: 50, background: () => (frame() < 10 ? "#ff0000" : "#0000ff") }} />
      </Panel>
    </Scene3D>
  )
}
"##;
    let dir = project("panel", main, &[]);
    let mut c = Composition::load(&dir).expect("loads");
    let p = frame(&mut c, &mut gpu, 0);
    assert_eq!(px(&p, 32, 24), [255, 0, 0, 255], "on the panel");
    assert_eq!(px(&p, 10, 15), [255, 0, 0, 255], "near its left edge");
    assert_eq!(px(&p, 6, 24), [0, 255, 0, 255], "beside it");
    assert_eq!(px(&p, 32, 10), [0, 255, 0, 255], "above it");
    // What it shows changes with the frame.
    let p = frame(&mut c, &mut gpu, 20);
    assert_eq!(px(&p, 32, 24), [0, 0, 255, 255]);
    // Not over the scene where it is laid out.
    let p = frame(&mut c, &mut gpu, 0);
    assert_eq!(px(&p, 1, 1), [0, 255, 0, 255]);
}

#[test]
fn effects_are_done_to_the_scene_in_order() {
    let Some(mut gpu) = gpu() else { return };
    let invert = r#"
struct U { amount: f32 }
@group(1) @binding(0) var<uniform> u: U;
fn effect(uv: vec2f) -> vec4f {
    let c = scene(uv);
    return vec4f(mix(c.rgb, vec3f(1.0) - c.rgb, u.amount), 1.0);
}
"#;
    let main = r##"import { useCurrentFrame } from "framescript"
import { Scene3D } from "framescript/3d"
import invert from "./invert.wgsl"
export default function Main() {
  const frame = useCurrentFrame()
  return (
    <Scene3D style={{ width: "100%", height: "100%" }} background="#00ff00"
      effects={[{ wgsl: invert, uniforms: { amount: () => (frame() < 10 ? 1 : 0) } }]} />
  )
}
"##;
    let dir = project("effect", main, &[("invert.wgsl", invert)]);
    let mut c = Composition::load(&dir).expect("loads");
    assert_eq!(px(&frame(&mut c, &mut gpu, 0), 32, 24), [255, 0, 255, 255], "turned over");
    assert_eq!(px(&frame(&mut c, &mut gpu, 20), 32, 24), [0, 255, 0, 255], "as it is");
}

/// How bright the frame is just beside a small white disc on black, with `effects`.
fn beside_a_light(name: &str, effects: &str) -> Option<u8> {
    let mut gpu = gpu()?;
    let main = format!(
        r##"import {{ bloom, OrthographicCamera, Scene3D, Sphere }} from "framescript/3d"
import white from "./white.wgsl"
export default function Main() {{
  return (
    <Scene3D style={{{{ width: "100%", height: "100%" }}}} background="#000000" effects={{{effects}}}>
      <OrthographicCamera position={{[0, 0, 10]}} height={{4}} />
      <Sphere radius={{0.5}} material={{{{ wgsl: white }}}} />
    </Scene3D>
  )
}}
"##
    );
    let white = "fn fragment(in: SurfaceInput) -> vec4f { return vec4f(1.0); }";
    let dir = project(name, &main, &[("white.wgsl", white)]);
    let mut c = Composition::load(&dir).expect("loads");
    let p = frame(&mut c, &mut gpu, 0);
    assert_eq!(px(&p, 32, 24), [255, 255, 255, 255], "the disc");
    // Half a unit out from its edge.
    Some(px(&p, 32 + 12, 24)[0])
}

#[test]
fn bloom_spreads_what_is_bright() {
    let Some(without) = beside_a_light("no-bloom", "[]") else { return };
    let with = beside_a_light("bloom", "[bloom({ strength: 1 })]").unwrap();
    assert_eq!(without, 0);
    assert!(with > 20, "the light spreads: {with}");
}
