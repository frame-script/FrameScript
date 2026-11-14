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
