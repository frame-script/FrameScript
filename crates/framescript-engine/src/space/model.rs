//! glTF models (`<Model>`): read once, then posed at any time.
//!
//! What a model looks like at a time is worked out from the time alone: its animation is sampled
//! there, the transforms of its nodes follow from the root, and skinned meshes are bent on the CPU.
//! So a model is a function of the frame like the rest, whichever frame is drawn first.
//!
//! Read: the scene's nodes and their transforms, meshes (positions, normals, the first uvs,
//! indices), materials (base color and its picture, metalness, roughness, emissive and its
//! strength, both sides, blending), skins, and animations of translation, rotation and scale
//! (linear, step and cubic spline). Not yet: morph targets, the other pictures of a material
//! (metallic-roughness, normal, occlusion, emissive), the alpha cutoff of `MASK`, cameras and
//! lights of the file.
//!
//! glTF は時刻だけから姿勢を計算する。スキニングは CPU で行う。

use super::Material;
use super::mesh::{self, MeshData};
use crate::shader::Picture;
use glam::{Mat4, Quat, Vec3, Vec4};
use gltf::animation::util::ReadOutputs;
use gltf::animation::{Interpolation, Property};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

pub struct ModelData {
    nodes: Vec<Node>,
    roots: Vec<usize>,
    /// By the index of the glTF mesh: its primitives.
    meshes: Vec<Vec<Part>>,
    skins: Vec<Skin>,
    pub animations: Vec<Animation>,
}

struct Node {
    children: Vec<usize>,
    translation: Vec3,
    rotation: Quat,
    scale: Vec3,
    mesh: Option<usize>,
    skin: Option<usize>,
}

struct Part {
    mesh: Arc<MeshData>,
    material: Material,
    /// What a skin bends, if it has a skin.
    skinned: Option<Skinned>,
}

struct Skinned {
    positions: Vec<Vec3>,
    normals: Vec<Vec3>,
    uvs: Vec<[f32; 2]>,
    joints: Vec<[u16; 4]>,
    weights: Vec<[f32; 4]>,
    indices: Vec<u32>,
}

struct Skin {
    joints: Vec<usize>,
    inverse_bind: Vec<Mat4>,
}

pub struct Animation {
    pub name: String,
    /// In seconds: to the last of its keys.
    pub duration: f32,
    channels: Vec<Channel>,
}

struct Channel {
    node: usize,
    property: Property,
    interpolation: Interpolation,
    times: Vec<f32>,
    /// Per key (three per key for a cubic spline: in-tangent, value, out-tangent). Three numbers
    /// for a translation or a scale, four for a rotation.
    values: Vec<Vec4>,
}

impl ModelData {
    pub fn load(path: &Path) -> Result<Arc<Self>, String> {
        let (doc, buffers, images) = gltf::import(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let data = |b: gltf::Buffer<'_>| Some(&*buffers[b.index()]);

        // Only the pictures that are base colors are made into pictures.
        let mut pictures: HashMap<usize, Arc<Picture>> = HashMap::new();
        let mut picture = |index: usize| -> Option<Arc<Picture>> {
            if let Some(p) = pictures.get(&index) {
                return Some(p.clone());
            }
            let p = rgba(images.get(index)?)?;
            pictures.insert(index, p.clone());
            Some(p)
        };

        let mut meshes = Vec::new();
        for m in doc.meshes() {
            let mut parts = Vec::new();
            for prim in m.primitives() {
                if prim.mode() != gltf::mesh::Mode::Triangles {
                    continue;
                }
                let r = prim.reader(data);
                let Some(positions) = r.read_positions() else {
                    continue;
                };
                let positions: Vec<Vec3> = positions.map(Vec3::from).collect();
                let normals: Option<Vec<Vec3>> = r.read_normals().map(|n| n.map(Vec3::from).collect());
                let uvs: Option<Vec<[f32; 2]>> = r.read_tex_coords(0).map(|t| t.into_f32().collect());
                let indices: Option<Vec<u32>> = r.read_indices().map(|i| i.into_u32().collect());
                let mesh = mesh::build(&positions, normals.as_deref(), uvs.as_deref(), indices.clone())
                    .map_err(|e| format!("{}: mesh {}: {e}", path.display(), m.index()))?;
                let skinned = match (r.read_joints(0), r.read_weights(0)) {
                    (Some(j), Some(w)) => Some(Skinned {
                        normals: normals.unwrap_or_else(|| {
                            mesh.vertices.chunks_exact(mesh::STRIDE).map(|v| Vec3::new(v[3], v[4], v[5])).collect()
                        }),
                        positions,
                        uvs: uvs.unwrap_or_default(),
                        joints: j.into_u16().collect(),
                        weights: w.into_f32().collect(),
                        indices: mesh.indices.clone(),
                    }),
                    _ => None,
                };
                parts.push(Part {
                    mesh,
                    material: material(&prim.material(), &mut picture),
                    skinned,
                });
            }
            meshes.push(parts);
        }

        let nodes = doc
            .nodes()
            .map(|n| {
                let (t, r, s) = n.transform().decomposed();
                Node {
                    children: n.children().map(|c| c.index()).collect(),
                    translation: Vec3::from(t),
                    rotation: Quat::from_array(r),
                    scale: Vec3::from(s),
                    mesh: n.mesh().map(|m| m.index()),
                    skin: n.skin().map(|s| s.index()),
                }
            })
            .collect();
        let roots = match doc.default_scene().or_else(|| doc.scenes().next()) {
            Some(scene) => scene.nodes().map(|n| n.index()).collect(),
            None => Vec::new(),
        };

        let skins = doc
            .skins()
            .map(|s| {
                let joints: Vec<usize> = s.joints().map(|j| j.index()).collect();
                let inverse_bind = s
                    .reader(data)
                    .read_inverse_bind_matrices()
                    .map(|m| m.map(|c| Mat4::from_cols_array_2d(&c)).collect())
                    .unwrap_or_else(|| vec![Mat4::IDENTITY; joints.len()]);
                Skin { joints, inverse_bind }
            })
            .collect();

        let animations = doc
            .animations()
            .map(|a| {
                let mut duration = 0.0f32;
                let channels = a
                    .channels()
                    .filter_map(|c| {
                        let r = c.reader(data);
                        let times: Vec<f32> = r.read_inputs()?.collect();
                        let values: Vec<Vec4> = match r.read_outputs()? {
                            ReadOutputs::Translations(t) => t.map(|v| Vec3::from(v).extend(0.0)).collect(),
                            ReadOutputs::Scales(s) => s.map(|v| Vec3::from(v).extend(0.0)).collect(),
                            ReadOutputs::Rotations(q) => q.into_f32().map(Vec4::from).collect(),
                            ReadOutputs::MorphTargetWeights(_) => return None,
                        };
                        duration = duration.max(times.last().copied().unwrap_or(0.0));
                        Some(Channel {
                            node: c.target().node().index(),
                            property: c.target().property(),
                            interpolation: c.sampler().interpolation(),
                            times,
                            values,
                        })
                    })
                    .collect();
                Animation {
                    name: a.name().map_or_else(|| format!("{}", a.index()), str::to_string),
                    duration,
                    channels,
                }
            })
            .collect();

        Ok(Arc::new(Self {
            nodes,
            roots,
            meshes,
            skins,
            animations,
        }))
    }

    /// The transform of every node relative to the model, with `animation` at `time` seconds.
    fn pose(&self, animation: Option<usize>, time: f32) -> Vec<Mat4> {
        let mut t: Vec<(Vec3, Quat, Vec3)> = self.nodes.iter().map(|n| (n.translation, n.rotation, n.scale)).collect();
        if let Some(a) = animation.and_then(|a| self.animations.get(a)) {
            for c in &a.channels {
                let Some(local) = t.get_mut(c.node) else {
                    continue;
                };
                let v = c.sample(time);
                match c.property {
                    Property::Translation => local.0 = v.truncate(),
                    Property::Scale => local.2 = v.truncate(),
                    Property::Rotation => local.1 = Quat::from_vec4(v).normalize(),
                    Property::MorphTargetWeights => {}
                }
            }
        }
        let mut global = vec![Mat4::IDENTITY; self.nodes.len()];
        let mut stack: Vec<(usize, Mat4)> = self.roots.iter().map(|&r| (r, Mat4::IDENTITY)).collect();
        // A node reached twice (which glTF forbids) is posed once.
        let mut seen = vec![false; self.nodes.len()];
        while let Some((i, parent)) = stack.pop() {
            if i >= self.nodes.len() || std::mem::replace(&mut seen[i], true) {
                continue;
            }
            let (tr, r, s) = t[i];
            global[i] = parent * Mat4::from_scale_rotation_translation(s, r, tr);
            stack.extend(self.nodes[i].children.iter().map(|&c| (c, global[i])));
        }
        global
    }

    /// What the model shows with `animation` at `time`, placed at `root`: each piece of it, where it
    /// is and what it is made of.
    pub fn place<'a>(&'a self, root: Mat4, animation: Option<usize>, time: f32, out: &mut Vec<(Mat4, Arc<MeshData>, &'a Material)>) {
        let global = self.pose(animation, time);
        let mut stack = self.roots.clone();
        let mut seen = vec![false; self.nodes.len()];
        while let Some(i) = stack.pop() {
            if i >= self.nodes.len() || std::mem::replace(&mut seen[i], true) {
                continue;
            }
            let node = &self.nodes[i];
            stack.extend(&node.children);
            let Some(parts) = node.mesh.and_then(|m| self.meshes.get(m)) else {
                continue;
            };
            let skin = node.skin.and_then(|s| self.skins.get(s));
            for part in parts {
                match (skin, &part.skinned) {
                    (Some(skin), Some(skinned)) => {
                        // Bent into the model's space; the node's own transform plays no part.
                        let joints: Vec<Mat4> = skin
                            .joints
                            .iter()
                            .zip(&skin.inverse_bind)
                            .map(|(&j, ib)| global.get(j).copied().unwrap_or(Mat4::IDENTITY) * *ib)
                            .collect();
                        if let Some(mesh) = skinned.bend(&joints) {
                            out.push((root, mesh, &part.material));
                        }
                    }
                    _ => out.push((root * global[i], part.mesh.clone(), &part.material)),
                }
            }
        }
    }
}

impl Skinned {
    fn bend(&self, joints: &[Mat4]) -> Option<Arc<MeshData>> {
        let n = self.positions.len();
        let mut positions = Vec::with_capacity(n);
        let mut normals = Vec::with_capacity(n);
        for i in 0..n {
            let (js, ws) = (self.joints.get(i)?, self.weights.get(i)?);
            let mut m = Mat4::ZERO;
            for k in 0..4 {
                if ws[k] != 0.0 {
                    m += *joints.get(js[k] as usize)? * ws[k];
                }
            }
            positions.push(m.transform_point3(self.positions[i]));
            normals.push(m.transform_vector3(self.normals[i]).normalize_or(Vec3::Y));
        }
        let uvs = (!self.uvs.is_empty()).then_some(self.uvs.as_slice());
        mesh::build(&positions, Some(&normals), uvs, Some(self.indices.clone())).ok()
    }
}

impl Channel {
    /// Its value at `time`: held before the first key and after the last.
    fn sample(&self, time: f32) -> Vec4 {
        let keys = self.times.len();
        let cubic = self.interpolation == Interpolation::CubicSpline;
        let value = |k: usize| if cubic { self.values[k * 3 + 1] } else { self.values[k] };
        if keys == 0 || self.values.len() < keys * if cubic { 3 } else { 1 } {
            return Vec4::ZERO;
        }
        if time <= self.times[0] {
            return value(0);
        }
        if time >= self.times[keys - 1] {
            return value(keys - 1);
        }
        let k = self.times.partition_point(|&t| t <= time) - 1;
        let (t0, t1) = (self.times[k], self.times[k + 1]);
        let dt = t1 - t0;
        let s = if dt > 0.0 { (time - t0) / dt } else { 0.0 };
        let rotation = self.property == Property::Rotation;
        match self.interpolation {
            Interpolation::Step => value(k),
            Interpolation::Linear if rotation => {
                let (a, b) = (Quat::from_vec4(value(k)), Quat::from_vec4(value(k + 1)));
                Vec4::from(a.slerp(b, s))
            }
            Interpolation::Linear => value(k).lerp(value(k + 1), s),
            Interpolation::CubicSpline => {
                let (v0, b0) = (self.values[k * 3 + 1], self.values[k * 3 + 2]);
                let (a1, v1) = (self.values[(k + 1) * 3], self.values[(k + 1) * 3 + 1]);
                let (s2, s3) = (s * s, s * s * s);
                let v = v0 * (2.0 * s3 - 3.0 * s2 + 1.0)
                    + b0 * dt * (s3 - 2.0 * s2 + s)
                    + v1 * (-2.0 * s3 + 3.0 * s2)
                    + a1 * dt * (s3 - s2);
                if rotation { v.normalize() } else { v }
            }
        }
    }
}

fn material(m: &gltf::Material<'_>, picture: &mut impl FnMut(usize) -> Option<Arc<Picture>>) -> Material {
    let pbr = m.pbr_metallic_roughness();
    let strength = m.emissive_strength().unwrap_or(1.0);
    Material {
        // glTF's colors are light already.
        color: pbr.base_color_factor(),
        metalness: pbr.metallic_factor(),
        roughness: pbr.roughness_factor(),
        emissive: m.emissive_factor().map(|e| e * strength),
        double_sided: m.double_sided(),
        transparent: m.alpha_mode() == gltf::material::AlphaMode::Blend,
        map: pbr
            .base_color_texture()
            .and_then(|t| picture(t.texture().source().index()))
            .map(crate::shader::Source::Picture),
        ..Material::default()
    }
}

/// A picture of the file as RGBA, if it is of 8 or 16 bits.
fn rgba(image: &gltf::image::Data) -> Option<Arc<Picture>> {
    use gltf::image::Format;
    let p = &image.pixels;
    let pixels: Vec<u8> = match image.format {
        Format::R8G8B8A8 => p.clone(),
        Format::R8G8B8 => p.chunks_exact(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect(),
        Format::R8G8 => p.chunks_exact(2).flat_map(|c| [c[0], c[0], c[0], c[1]]).collect(),
        Format::R8 => p.iter().flat_map(|&c| [c, c, c, 255]).collect(),
        // The high byte of each.
        Format::R16G16B16A16 => p.chunks_exact(2).map(|c| c[1]).collect(),
        Format::R16G16B16 => p.chunks_exact(6).flat_map(|c| [c[1], c[3], c[5], 255]).collect(),
        _ => return None,
    };
    Some(Picture::from_rgba(image.width, image.height, pixels))
}
