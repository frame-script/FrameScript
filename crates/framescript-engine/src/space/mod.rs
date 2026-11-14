//! Things in 3D: `<Scene3D>` and what is in it.
//!
//! The scripts make the things as they make nodes (`op_fs_create`) and set what they are with
//! [`crate::commands::op::PARAM`]. The things of a scene make a tree of their own, beside the
//! document; the scene itself is a box of the document, a portable canvas. Once a frame's commands
//! are in, every scene whose things changed is handed to its box as a [`View`], a snapshot with the
//! matrices worked out, which [`paint::SpacePaint`] draws on whatever device draws the scene.
//!
//! 3D の物は文書とは別の木になる。変わったシーンだけ、行列を計算したスナップショットを箱に渡す。

pub mod mesh;
pub mod paint;

use crate::shader::{Hooks, Picture, Shader};
use anti_webui_core::tree::{Document, NodeId, NodeKind};
use glam::{EulerRot, Mat3, Mat4, Quat, Vec3};
use mesh::MeshData;
use std::collections::HashMap;
use std::sync::{Arc, Weak};

/// The parameters of things and scenes, by number (the same in `internal/commands.ts`). Each is
/// some numbers; none takes it back to what it was at first.
pub mod param {
    // Every thing.
    pub const POSITION: u32 = 0;
    pub const ROTATION: u32 = 1;
    pub const QUATERNION: u32 = 2;
    pub const SCALE: u32 = 3;
    pub const LOOK_AT: u32 = 4;
    pub const VISIBLE: u32 = 5;
    // Meshes.
    pub const GEOMETRY: u32 = 10;
    pub const COLOR: u32 = 11;
    pub const METALNESS: u32 = 12;
    pub const ROUGHNESS: u32 = 13;
    pub const EMISSIVE: u32 = 14;
    pub const OPACITY: u32 = 15;
    pub const DOUBLE_SIDED: u32 = 16;
    pub const TRANSPARENT: u32 = 17;
    /// The id of a shader (`op_fs_shader`).
    pub const SHADER: u32 = 18;
    /// The number of a uniform, then its numbers.
    pub const UNIFORM: u32 = 19;
    // Cameras.
    pub const FOV: u32 = 30;
    pub const NEAR: u32 = 31;
    pub const FAR: u32 = 32;
    pub const ORTHOGRAPHIC: u32 = 33;
    pub const ACTIVE: u32 = 34;
    // Lights.
    pub const LIGHT: u32 = 40;
    pub const LIGHT_COLOR: u32 = 41;
    pub const INTENSITY: u32 = 42;
    pub const RANGE: u32 = 43;
    pub const ANGLE: u32 = 44;
    pub const PENUMBRA: u32 = 45;
    pub const GROUND_COLOR: u32 = 46;
    // Scenes (and `<Shader>` boxes, for the time).
    pub const BACKGROUND: u32 = 50;
    pub const TONE_MAPPING: u32 = 51;
    pub const EXPOSURE: u32 = 52;
    /// Seconds and the frame, of the clip.
    pub const TIME: u32 = 53;
}

/// The parameters given as text, with [`crate::commands::op::PARAM_TEXT`]: an index, then a file.
pub mod text_param {
    /// The picture the color is multiplied by.
    pub const MAP: u32 = 0;
    /// A texture of the shader, by its index.
    pub const TEXTURE: u32 = 1;
}

/// What a thing is made as (`op_fs_create`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Group,
    Mesh,
    Camera,
    Light,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LightKind {
    Ambient,
    Directional,
    Point,
    Spot,
    Hemisphere,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToneMapping {
    None,
    Neutral,
    Aces,
}

pub struct Thing {
    kind: Kind,
    children: Vec<u32>,
    position: Vec3,
    /// In degrees, X then Y then Z, as three.js.
    rotation: Vec3,
    quaternion: Option<Quat>,
    scale: Vec3,
    look_at: Option<Vec3>,
    visible: bool,
    mesh: Option<Arc<MeshData>>,
    material: Material,
    camera: Camera,
    light: Light,
}

#[derive(Clone)]
pub struct Material {
    /// Light, not premultiplied.
    pub color: [f32; 4],
    pub opacity: f32,
    pub metalness: f32,
    pub roughness: f32,
    /// Light.
    pub emissive: [f32; 3],
    pub double_sided: bool,
    pub transparent: bool,
    pub map: Option<Arc<Picture>>,
    pub shader: Option<Arc<Shader>>,
    pub uniforms: Arc<Vec<u8>>,
    pub textures: Arc<Vec<Option<Arc<Picture>>>>,
}

impl Default for Material {
    fn default() -> Self {
        Self {
            color: [1.0; 4],
            opacity: 1.0,
            metalness: 0.0,
            roughness: 0.5,
            emissive: [0.0; 3],
            double_sided: false,
            transparent: false,
            map: None,
            shader: None,
            uniforms: Arc::default(),
            textures: Arc::default(),
        }
    }
}

struct Camera {
    orthographic: bool,
    /// Vertical, in degrees; for an orthographic camera, how high what it sees is.
    fov: f32,
    near: f32,
    far: f32,
    active: bool,
}

struct Light {
    kind: LightKind,
    color: Vec3,
    intensity: f32,
    range: f32,
    /// Of a spot, from its middle to its edge, in degrees.
    angle: f32,
    penumbra: f32,
    ground: Vec3,
}

impl Thing {
    fn new(kind: Kind) -> Self {
        Self {
            kind,
            children: Vec::new(),
            position: Vec3::ZERO,
            rotation: Vec3::ZERO,
            quaternion: None,
            scale: Vec3::ONE,
            look_at: None,
            visible: true,
            mesh: None,
            material: Material::default(),
            camera: Camera {
                orthographic: false,
                fov: 50.0,
                near: 0.1,
                far: 1000.0,
                active: true,
            },
            light: Light {
                kind: LightKind::Directional,
                color: Vec3::ONE,
                intensity: 1.0,
                range: 0.0,
                angle: 30.0,
                penumbra: 0.0,
                ground: Vec3::splat(0.25),
            },
        }
    }
}

/// A `<Scene3D>`.
struct World {
    node: NodeId,
    roots: Vec<u32>,
    background: [f32; 4],
    tone: ToneMapping,
    exposure: f32,
    time: [f32; 2],
}

/// All things of a composition, and its scenes.
#[derive(Default)]
pub struct Spaces {
    things: Vec<Option<Thing>>,
    free: Vec<u32>,
    /// By the handle of their box.
    worlds: HashMap<u32, World>,
    /// The shapes made so far, by what they were made from.
    shapes: HashMap<Vec<u32>, Weak<MeshData>>,
    changed: bool,
}

impl Spaces {
    pub fn create(&mut self, kind: Kind) -> u32 {
        let thing = Thing::new(kind);
        match self.free.pop() {
            Some(id) => {
                self.things[id as usize] = Some(thing);
                id
            }
            None => {
                self.things.push(Some(thing));
                (self.things.len() - 1) as u32
            }
        }
    }

    pub fn remove(&mut self, id: u32) {
        if let Some(t) = self.things.get_mut(id as usize)
            && t.take().is_some()
        {
            self.free.push(id);
            self.changed = true;
        }
    }

    /// Makes the box `node` (known to the scripts as `handle`) a scene.
    pub fn add_world(&mut self, handle: u32, node: NodeId) {
        self.worlds.insert(
            handle,
            World {
                node,
                roots: Vec::new(),
                background: [0.0; 4],
                tone: ToneMapping::Neutral,
                exposure: 1.0,
                time: [0.0; 2],
            },
        );
        self.changed = true;
    }

    pub fn remove_world(&mut self, handle: u32) {
        self.worlds.remove(&handle);
    }

    pub fn is_world(&self, handle: u32) -> bool {
        self.worlds.contains_key(&handle)
    }

    pub fn set_children(&mut self, id: u32, children: Vec<u32>) {
        if let Some(Some(t)) = self.things.get_mut(id as usize) {
            t.children = children;
            self.changed = true;
        }
    }

    pub fn set_roots(&mut self, handle: u32, roots: Vec<u32>) {
        if let Some(w) = self.worlds.get_mut(&handle) {
            w.roots = roots;
            self.changed = true;
        }
    }

    /// Sets a parameter of the scene `handle`. Says whether it is one of a scene.
    pub fn set_world(&mut self, handle: u32, param: u32, v: &[f32]) -> bool {
        let Some(w) = self.worlds.get_mut(&handle) else {
            return false;
        };
        match param {
            param::BACKGROUND => w.background = array(v, [0.0; 4]),
            param::TONE_MAPPING => {
                w.tone = match v.first().map(|t| *t as u32) {
                    Some(0) => ToneMapping::None,
                    Some(2) => ToneMapping::Aces,
                    _ => ToneMapping::Neutral,
                }
            }
            param::EXPOSURE => w.exposure = v.first().copied().unwrap_or(1.0),
            param::TIME => w.time = array(v, [0.0; 2]),
            _ => return false,
        }
        self.changed = true;
        true
    }

    /// Sets a parameter of the thing `id`.
    pub fn set(&mut self, id: u32, param: u32, v: &[f32], shaders: &[Arc<Shader>]) -> Result<(), String> {
        let shapes = &mut self.shapes;
        let Some(Some(t)) = self.things.get_mut(id as usize) else {
            return Ok(());
        };
        self.changed = true;
        let one = |default: f32| v.first().copied().unwrap_or(default);
        let three = |default: Vec3| Vec3::from_array(array(v, default.to_array()));
        let m = &mut t.material;
        match param {
            param::POSITION => t.position = three(Vec3::ZERO),
            param::ROTATION => t.rotation = three(Vec3::ZERO),
            param::QUATERNION => {
                t.quaternion = (v.len() == 4).then(|| Quat::from_xyzw(v[0], v[1], v[2], v[3]).normalize())
            }
            param::SCALE => {
                t.scale = match v {
                    [s] => Vec3::splat(*s),
                    _ => three(Vec3::ONE),
                }
            }
            param::LOOK_AT => t.look_at = (v.len() == 3).then(|| Vec3::from_slice(v)),
            param::VISIBLE => t.visible = one(1.0) != 0.0,
            param::GEOMETRY => {
                let Some((&kind, args)) = v.split_first() else {
                    t.mesh = None;
                    return Ok(());
                };
                let kind = kind as u32;
                let key: Vec<u32> = v.iter().map(|f| f.to_bits()).collect();
                let cached = (kind != mesh::shape::CUSTOM).then(|| shapes.get(&key).and_then(Weak::upgrade));
                t.mesh = Some(match cached.flatten() {
                    Some(m) => m,
                    None => {
                        let made = mesh::make(kind, args)?;
                        if kind != mesh::shape::CUSTOM {
                            shapes.retain(|_, m| m.strong_count() > 0);
                            shapes.insert(key, Arc::downgrade(&made));
                        }
                        made
                    }
                });
            }
            param::COLOR => m.color = array(v, [1.0; 4]),
            param::METALNESS => m.metalness = one(0.0),
            param::ROUGHNESS => m.roughness = one(0.5),
            param::EMISSIVE => m.emissive = array(v, [0.0; 3]),
            param::OPACITY => m.opacity = one(1.0),
            param::DOUBLE_SIDED => m.double_sided = one(0.0) != 0.0,
            param::TRANSPARENT => m.transparent = one(0.0) != 0.0,
            param::SHADER => {
                let shader = v.first().and_then(|&i| shaders.get(i as usize)).cloned();
                if shader.as_ref().map(|s| s.id) != m.shader.as_ref().map(|s| s.id) {
                    m.uniforms = Arc::new(shader.as_ref().map(|s| s.blank_uniforms()).unwrap_or_default());
                    m.textures = Arc::new(vec![None; shader.as_ref().map_or(0, |s| s.textures.len())]);
                    m.shader = shader;
                }
            }
            param::UNIFORM => {
                if let (Some(shader), Some((&member, values))) = (&m.shader, v.split_first()) {
                    shader.write_uniform(Arc::make_mut(&mut m.uniforms).as_mut_slice(), member as usize, values)?;
                }
            }
            param::FOV => t.camera.fov = one(50.0),
            param::NEAR => t.camera.near = one(0.1),
            param::FAR => t.camera.far = one(1000.0),
            param::ORTHOGRAPHIC => t.camera.orthographic = one(0.0) != 0.0,
            param::ACTIVE => t.camera.active = one(1.0) != 0.0,
            param::LIGHT => {
                t.light.kind = match one(1.0) as u32 {
                    0 => LightKind::Ambient,
                    2 => LightKind::Point,
                    3 => LightKind::Spot,
                    4 => LightKind::Hemisphere,
                    _ => LightKind::Directional,
                }
            }
            param::LIGHT_COLOR => t.light.color = three(Vec3::ONE),
            param::INTENSITY => t.light.intensity = one(1.0),
            param::RANGE => t.light.range = one(0.0),
            param::ANGLE => t.light.angle = one(30.0),
            param::PENUMBRA => t.light.penumbra = one(0.0),
            param::GROUND_COLOR => t.light.ground = three(Vec3::splat(0.25)),
            other => return Err(format!("no parameter {other} of a thing in 3D")),
        }
        Ok(())
    }

    /// Sets a picture of the thing `id`.
    pub fn set_picture(&mut self, id: u32, param: u32, index: u32, picture: Option<Arc<Picture>>) {
        let Some(Some(t)) = self.things.get_mut(id as usize) else {
            return;
        };
        self.changed = true;
        let m = &mut t.material;
        match param {
            text_param::MAP => m.map = picture,
            text_param::TEXTURE => {
                if let Some(slot) = Arc::make_mut(&mut m.textures).get_mut(index as usize) {
                    *slot = picture;
                }
            }
            _ => {}
        }
    }

    /// Hands every scene to its box, if anything changed since the last time.
    pub fn sync(&mut self, doc: &mut Document) {
        if !std::mem::take(&mut self.changed) {
            return;
        }
        for w in self.worlds.values() {
            let view = self.view(w);
            if let Some(NodeKind::Canvas(c)) = doc.get_mut(w.node).map(|n| &mut n.kind) {
                c.set_paint(anti_webui_wgpu::canvas::portable::<paint::SpacePaint>(paint::SpaceProps(
                    Arc::new(view),
                )));
                doc.mark_shader_of(w.node);
            }
        }
    }

    fn view(&self, w: &World) -> View {
        let mut v = View {
            background: w.background,
            tone: w.tone,
            exposure: w.exposure,
            time: w.time,
            camera: None,
            lights: Vec::new(),
            ambient: Vec3::ZERO,
            sky: Vec3::ZERO,
            ground: Vec3::ZERO,
            objects: Vec::new(),
        };
        let mut lit = false;
        for &root in &w.roots {
            self.collect(root, Mat4::IDENTITY, &mut v, &mut lit);
        }
        if !lit {
            // Something to see by when nothing is said.
            v.sky = Vec3::splat(0.5);
            v.ground = Vec3::splat(0.15);
            v.lights.push(LightView {
                kind: LightKind::Directional,
                color: Vec3::splat(0.8),
                position: Vec3::new(3.0, 5.0, 4.0),
                direction: Vec3::new(-3.0, -5.0, -4.0).normalize(),
                range: 0.0,
                cos_outer: 0.0,
                cos_inner: 0.0,
            });
        }
        v
    }

    fn collect(&self, id: u32, parent: Mat4, v: &mut View, lit: &mut bool) {
        let Some(Some(t)) = self.things.get(id as usize) else {
            return;
        };
        if !t.visible {
            return;
        }
        let world = transform(t, parent);
        let position = world.w_axis.truncate();
        match t.kind {
            Kind::Group => {}
            Kind::Mesh => {
                if let Some(mesh) = &t.mesh {
                    v.objects.push(ObjectView {
                        model: world,
                        mesh: mesh.clone(),
                        material: t.material.clone(),
                    });
                }
            }
            Kind::Camera => {
                if t.camera.active {
                    let c = &t.camera;
                    v.camera = Some(CameraView {
                        world,
                        orthographic: c.orthographic,
                        fov: c.fov,
                        near: c.near,
                        far: c.far,
                    });
                }
            }
            Kind::Light => {
                *lit = true;
                let l = &t.light;
                let color = l.color * l.intensity;
                let target = t.look_at.unwrap_or(Vec3::ZERO);
                let direction = (target - position).normalize_or(-Vec3::Y);
                match l.kind {
                    LightKind::Ambient => v.ambient += color,
                    LightKind::Hemisphere => {
                        v.sky += color;
                        v.ground += l.ground * l.intensity;
                    }
                    kind => {
                        let outer = l.angle.clamp(0.0, 90.0).to_radians();
                        let inner = outer * (1.0 - l.penumbra.clamp(0.0, 1.0));
                        v.lights.push(LightView {
                            kind,
                            color,
                            position,
                            direction,
                            range: l.range.max(0.0),
                            cos_outer: outer.cos(),
                            cos_inner: inner.cos().max(outer.cos() + 1e-4),
                        });
                    }
                }
            }
        }
        for &child in &t.children {
            self.collect(child, world, v, lit);
        }
    }
}

/// Where a thing is, in the scene: `parent` and then its own place. With `look_at`, it is turned
/// to look at that point of the scene (a camera or a light with its -Z, anything else with its +Z).
fn transform(t: &Thing, parent: Mat4) -> Mat4 {
    let rotation = t.quaternion.unwrap_or_else(|| {
        let r = t.rotation * (std::f32::consts::PI / 180.0);
        Quat::from_euler(EulerRot::XYZ, r.x, r.y, r.z)
    });
    let local = Mat4::from_scale_rotation_translation(t.scale, rotation, t.position);
    let world = parent * local;
    let Some(target) = t.look_at else {
        return world;
    };
    let (scale, _, position) = world.to_scale_rotation_translation();
    let forward = (target - position).normalize_or(-Vec3::Z);
    let z = if matches!(t.kind, Kind::Camera | Kind::Light) { -forward } else { forward };
    let up = if z.cross(Vec3::Y).length_squared() < 1e-8 { Vec3::Z } else { Vec3::Y };
    let x = up.cross(z).normalize();
    let y = z.cross(x);
    let turned = Quat::from_mat3(&Mat3::from_cols(x, y, z));
    Mat4::from_scale_rotation_translation(scale, turned, position)
}

fn array<const N: usize>(v: &[f32], default: [f32; N]) -> [f32; N] {
    let mut out = default;
    for (o, x) in out.iter_mut().zip(v) {
        *o = *x;
    }
    out
}

/// A scene as it is drawn: everything in it where it is.
pub struct View {
    /// Light, not premultiplied.
    pub background: [f32; 4],
    pub tone: ToneMapping,
    pub exposure: f32,
    pub time: [f32; 2],
    /// `None` for the camera that is there when there is none.
    pub camera: Option<CameraView>,
    pub lights: Vec<LightView>,
    pub ambient: Vec3,
    pub sky: Vec3,
    pub ground: Vec3,
    pub objects: Vec<ObjectView>,
}

pub struct CameraView {
    /// Where it is and which way it looks: down its -Z.
    pub world: Mat4,
    pub orthographic: bool,
    pub fov: f32,
    pub near: f32,
    pub far: f32,
}

pub struct LightView {
    pub kind: LightKind,
    /// Its color times its intensity.
    pub color: Vec3,
    pub position: Vec3,
    /// The way its light goes.
    pub direction: Vec3,
    pub range: f32,
    pub cos_outer: f32,
    pub cos_inner: f32,
}

pub struct ObjectView {
    pub model: Mat4,
    pub mesh: Arc<MeshData>,
    pub material: Material,
}

/// What FrameScript adds after the code of a material.
pub fn material_code(h: Hooks) -> String {
    let mut s = String::from(MATERIAL);
    s.push_str(if h.vertex {
        "fn fs_vertex_hook(v: Vertex) -> Vertex { return vertex(v); }\n"
    } else {
        "fn fs_vertex_hook(v: Vertex) -> Vertex { return v; }\n"
    });
    if h.fragment {
        s.push_str(UNLIT);
    } else {
        s.push_str(if h.surface {
            "fn fs_surface_hook(in: SurfaceInput) -> Surface { return surface(in); }\n"
        } else {
            "fn fs_surface_hook(in: SurfaceInput) -> Surface { return default_surface(in); }\n"
        });
        s.push_str(LIT);
    }
    s
}

const MATERIAL: &str = r#"
// ---- FrameScript (3D) ----
struct FrameScript {
    view_projection: mat4x4f,
    camera_position: vec3f,
    /// Seconds into the clip.
    time: f32,
    /// The size of the scene, in its pixels.
    resolution: vec2f,
    /// The frame of the clip.
    frame: f32,
    light_count: u32,
    ambient: vec3f,
    sky: vec3f,
    ground: vec3f,
    exposure: f32,
    /// 0 for none, 1 for Khronos PBR Neutral, 2 for ACES.
    tone_mapping: u32,
}

struct FsLight {
    color: vec3f,
    kind: u32,
    position: vec3f,
    range: f32,
    direction: vec3f,
    cos_outer: f32,
    cos_inner: f32,
}

struct FsObject {
    model: mat4x4f,
    normal_matrix: mat4x4f,
    color: vec4f,
    emissive: vec3f,
    metalness: f32,
    roughness: f32,
}

@group(0) @binding(0) var<uniform> fs: FrameScript;
@group(0) @binding(1) var<storage, read> fs_lights: array<FsLight>;
@group(0) @binding(2) var<storage, read> fs_objects: array<FsObject>;
@group(2) @binding(0) var fs_map: texture_2d<f32>;
@group(2) @binding(1) var fs_map_sampler: sampler;

/// A vertex, where the shape has it.
struct Vertex {
    position: vec3f,
    normal: vec3f,
    uv: vec2f,
}

/// A point of a surface, in the scene.
struct SurfaceInput {
    @builtin(position) clip_position: vec4f,
    @location(0) world_position: vec3f,
    /// Toward the side that is seen.
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
    @location(3) @interpolate(flat) object: u32,
}

/// What a surface is like at a point. Colors are light.
struct Surface {
    albedo: vec3f,
    alpha: f32,
    metalness: f32,
    roughness: f32,
    emissive: vec3f,
    normal: vec3f,
}

/// The surface as the material's color, map, metalness, roughness and emissive make it.
fn default_surface(in: SurfaceInput) -> Surface {
    let o = fs_objects[in.object];
    let texel = textureSample(fs_map, fs_map_sampler, in.uv);
    var s: Surface;
    s.albedo = o.color.rgb * texel.rgb;
    s.alpha = o.color.a * texel.a;
    s.metalness = o.metalness;
    s.roughness = o.roughness;
    s.emissive = o.emissive;
    s.normal = normalize(in.normal);
    return s;
}

@vertex
fn fs_vertex_main(
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) uv: vec2f,
    @builtin(instance_index) object: u32,
) -> SurfaceInput {
    let v = fs_vertex_hook(Vertex(position, normal, uv));
    let o = fs_objects[object];
    let world = o.model * vec4f(v.position, 1.0);
    var out: SurfaceInput;
    out.clip_position = fs.view_projection * world;
    out.world_position = world.xyz;
    out.normal = normalize((o.normal_matrix * vec4f(v.normal, 0.0)).xyz);
    out.uv = v.uv;
    out.object = object;
    return out;
}

const FS_PI: f32 = 3.14159265;

/// The light that leaves a surface toward the camera.
fn fs_shade(s: Surface, p: vec3f) -> vec3f {
    let n = normalize(s.normal);
    let v = normalize(fs.camera_position - p);
    let rough = clamp(s.roughness, 0.04, 1.0);
    let a2 = rough * rough * rough * rough;
    let f0 = mix(vec3f(0.04), s.albedo, s.metalness);
    let diffuse = s.albedo * (1.0 - s.metalness);
    let nv = max(dot(n, v), 1e-4);
    var light = vec3f(0.0);
    for (var i = 0u; i < fs.light_count; i++) {
        let l = fs_lights[i];
        var dir = -l.direction;
        // Lights are as bright as their intensity says on what faces them: that is π times the
        // light that comes in, for a surface that sends it out evenly.
        var radiance = l.color * FS_PI;
        if l.kind != 1u {
            let to = l.position - p;
            let d = length(to);
            dir = to / max(d, 1e-4);
            radiance /= max(d * d, 1e-4);
            if l.range > 0.0 {
                let r = d / l.range;
                let w = clamp(1.0 - r * r * r * r, 0.0, 1.0);
                radiance *= w * w;
            }
            if l.kind == 3u {
                radiance *= smoothstep(l.cos_outer, l.cos_inner, dot(-dir, l.direction));
            }
        }
        let nl = dot(n, dir);
        if nl <= 0.0 {
            continue;
        }
        let h = normalize(v + dir);
        let nh = max(dot(n, h), 0.0);
        let vh = max(dot(v, h), 0.0);
        let dd = nh * nh * (a2 - 1.0) + 1.0;
        let d = a2 / (FS_PI * dd * dd);
        let k = (rough + 1.0) * (rough + 1.0) / 8.0;
        let g = nv / (nv * (1.0 - k) + k) * nl / (nl * (1.0 - k) + k);
        let f = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
        let specular = d * g * f / (4.0 * nv * nl + 1e-4);
        light += ((1.0 - f) * diffuse / FS_PI + specular) * radiance * nl;
    }
    let around = fs.ambient + mix(fs.ground, fs.sky, n.y * 0.5 + 0.5);
    let fa = f0 + (max(vec3f(1.0 - rough), f0) - f0) * pow(1.0 - nv, 5.0);
    light += around * (diffuse * (1.0 - fa) + fa);
    return light + s.emissive;
}

/// Khronos PBR Neutral: colors stay as they are up to 0.76, and what is brighter comes down to 1.
fn fs_neutral(color: vec3f) -> vec3f {
    let start = 0.8 - 0.04;
    let x = min(color.r, min(color.g, color.b));
    let offset = select(0.04, x - 6.25 * x * x, x < 0.08);
    var c = color - offset;
    let peak = max(c.r, max(c.g, c.b));
    if peak < start {
        return c;
    }
    let d = 1.0 - start;
    let top = 1.0 - d * d / (peak + d - start);
    c *= top / peak;
    let g = 1.0 - 1.0 / (0.15 * (peak - top) + 1.0);
    return mix(c, vec3f(top), g);
}

/// Light, as much as the camera lets in, to what shows (from 0 to 1).
fn fs_tone_map(light: vec3f) -> vec3f {
    let x = max(light * fs.exposure, vec3f(0.0));
    if fs.tone_mapping == 1u {
        return fs_neutral(x);
    }
    if fs.tone_mapping == 2u {
        return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
    }
    return x;
}
"#;

const LIT: &str = r#"
@fragment
fn fs_fragment_main(in: SurfaceInput, @builtin(front_facing) front: bool) -> @location(0) vec4f {
    var seen = in;
    if !front {
        seen.normal = -seen.normal;
    }
    let s = fs_surface_hook(seen);
    let a = clamp(s.alpha, 0.0, 1.0);
    return vec4f(fs_tone_map(fs_shade(s, seen.world_position)) * a, a);
}
"#;

const UNLIT: &str = r#"
@fragment
fn fs_fragment_main(in: SurfaceInput, @builtin(front_facing) front: bool) -> @location(0) vec4f {
    var seen = in;
    if !front {
        seen.normal = -seen.normal;
    }
    let c = fragment(seen);
    let a = clamp(c.a, 0.0, 1.0);
    return vec4f(c.rgb * a, a);
}
"#;
