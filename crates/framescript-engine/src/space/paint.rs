//! Draws a scene in 3D (a [`View`]) into its box, on whatever device draws the composition's scene.
//!
//! Everything is drawn as light into a 4× multisampled half-float target with a depth buffer:
//! opaque things first, then those that can be seen through, from the farthest. What is lit is
//! tone mapped where it is drawn (as three.js does), so that the background and materials that
//! give their colors themselves (`fragment`) come out as they are given. A last pass stores the
//! light as sRGB and premultiplies it, which is what the box holds.

use super::mesh::{MeshData, STRIDE};
use super::{ToneMapping, View};
use crate::gpu::{self, Growing, Pictures};
use crate::shader::{Shader, Stage};
use anti_webui_wgpu::canvas::{GpuFrame, GpuInit, GpuPaint};
use anti_webui_wgpu::wgpu;
use bytemuck::{Pod, Zeroable};
use glam::camera::rh::proj::directx as proj;
use glam::{Mat4, Vec3};
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Weak};

#[derive(Clone)]
pub struct SpaceProps(pub Arc<View>);

impl PartialEq for SpaceProps {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

const SAMPLES: u32 = 4;
const LIGHT_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;

/// The material of things that have no WGSL of their own.
static STANDARD: LazyLock<Arc<Shader>> = LazyLock::new(|| {
    Arc::new(Shader::compile("", "standard material", Stage::Material).expect("the standard material compiles"))
});

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Globals {
    view_projection: [f32; 16],
    camera_position: [f32; 3],
    time: f32,
    resolution: [f32; 2],
    frame: f32,
    light_count: u32,
    ambient: [f32; 3],
    _a: f32,
    sky: [f32; 3],
    _b: f32,
    ground: [f32; 3],
    exposure: f32,
    tone_mapping: u32,
    _c: [f32; 3],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct GpuLight {
    color: [f32; 3],
    kind: u32,
    position: [f32; 3],
    range: f32,
    direction: [f32; 3],
    cos_outer: f32,
    cos_inner: f32,
    _pad: [f32; 3],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct GpuObject {
    model: [f32; 16],
    normal_matrix: [f32; 16],
    color: [f32; 4],
    emissive: [f32; 3],
    metalness: f32,
    roughness: f32,
    _pad: [f32; 3],
}

/// What a scene is drawn into: as big as its box.
struct Targets {
    size: (u32, u32),
    light: wgpu::TextureView,
    resolved: wgpu::TextureView,
    depth: wgpu::TextureView,
    finish: wgpu::BindGroup,
}

struct Mesh {
    of: Weak<MeshData>,
    vertices: wgpu::Buffer,
    indices: wgpu::Buffer,
    count: u32,
}

/// The pipelines of a shader, and the layout of its `@group(1)`.
struct Material {
    of: Weak<Shader>,
    user: wgpu::BindGroupLayout,
    /// By whether it is seen through, and whether both of its sides are drawn.
    pipelines: HashMap<(bool, bool), wgpu::RenderPipeline>,
}

pub struct SpacePaint {
    format: wgpu::TextureFormat,
    frame_layout: wgpu::BindGroupLayout,
    map_layout: wgpu::BindGroupLayout,
    globals: wgpu::Buffer,
    lights: Growing,
    objects: Growing,
    /// The uniforms of the materials of all things, each at an offset of its own.
    uniforms: Growing,
    align: u32,
    frame_bind: Option<wgpu::BindGroup>,
    materials: HashMap<u64, Material>,
    meshes: HashMap<u64, Mesh>,
    pictures: Pictures,
    /// What binds the map of a thing, by the picture (0 for none).
    maps: HashMap<u64, wgpu::BindGroup>,
    sampler: wgpu::Sampler,
    targets: Option<Targets>,
    finish_layout: wgpu::BindGroupLayout,
    finish_pipeline: wgpu::RenderPipeline,
}

impl GpuPaint for SpacePaint {
    type Props = SpaceProps;

    fn new(gpu: &GpuInit<'_>) -> Self {
        let device = gpu.device;
        let storage = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Storage { read_only: true },
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        let frame_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene3d frame"),
            entries: &[uniform_entry(0, wgpu::ShaderStages::VERTEX_FRAGMENT), storage(1), storage(2)],
        });
        let map_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene3d map"),
            entries: &[texture_entry(0, true), sampler_entry(1)],
        });
        let finish_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene3d finish"),
            entries: &[texture_entry(0, false)],
        });
        let finish_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("scene3d finish"),
            source: wgpu::ShaderSource::Wgsl(FINISH.into()),
        });
        let finish_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("scene3d finish"),
            layout: Some(&device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("scene3d finish"),
                bind_group_layouts: &[Some(&finish_layout)],
                immediate_size: 0,
            })),
            vertex: wgpu::VertexState {
                module: &finish_module,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &finish_module,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(gpu.format.into())],
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        let buffer = |label, size, usage| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(label),
                size,
                usage: usage | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            })
        };
        Self {
            format: gpu.format,
            frame_layout,
            map_layout,
            globals: buffer("scene3d fs", size_of::<Globals>() as u64, wgpu::BufferUsages::UNIFORM),
            lights: Growing::new(device, "scene3d lights", wgpu::BufferUsages::STORAGE),
            objects: Growing::new(device, "scene3d objects", wgpu::BufferUsages::STORAGE),
            uniforms: Growing::new(device, "scene3d uniforms", wgpu::BufferUsages::UNIFORM),
            align: device.limits().min_uniform_buffer_offset_alignment.max(16),
            frame_bind: None,
            materials: HashMap::new(),
            meshes: HashMap::new(),
            pictures: Pictures::new(device, gpu.queue),
            maps: HashMap::new(),
            sampler: gpu::sampler(device),
            targets: None,
            finish_layout,
            finish_pipeline,
        }
    }

    fn render(&mut self, props: &SpaceProps, frame: &mut GpuFrame<'_>) {
        let view = &*props.0;
        let (device, queue) = (frame.device, frame.queue);
        if self.targets.as_ref().is_none_or(|t| t.size != frame.size) {
            self.targets = Some(self.make_targets(device, frame.size));
        }
        self.retain();

        // Where the camera is and what it sees.
        let aspect = frame.size.0 as f32 / frame.size.1.max(1) as f32;
        let (camera_world, projection) = match &view.camera {
            Some(c) => {
                let projection = if c.orthographic {
                    let h = c.fov.max(1e-3) / 2.0;
                    proj::orthographic(-h * aspect, h * aspect, -h, h, c.near, c.far)
                } else {
                    proj::perspective(c.fov.clamp(1.0, 179.0).to_radians(), aspect, c.near.max(1e-4), c.far)
                };
                (c.world, projection)
            }
            None => (
                Mat4::from_translation(Vec3::new(0.0, 0.0, 5.0)),
                proj::perspective(50f32.to_radians(), aspect, 0.1, 1000.0),
            ),
        };
        let view_matrix = camera_world.inverse();
        let camera_position = camera_world.w_axis.truncate();

        let globals = Globals {
            view_projection: (projection * view_matrix).to_cols_array(),
            camera_position: camera_position.to_array(),
            time: view.time[0],
            resolution: [frame.size.0 as f32, frame.size.1 as f32],
            frame: view.time[1],
            light_count: view.lights.len() as u32,
            ambient: view.ambient.to_array(),
            sky: view.sky.to_array(),
            ground: view.ground.to_array(),
            exposure: view.exposure,
            tone_mapping: match view.tone {
                ToneMapping::None => 0,
                ToneMapping::Neutral => 1,
                ToneMapping::Aces => 2,
            },
            ..Zeroable::zeroed()
        };
        queue.write_buffer(&self.globals, 0, bytemuck::bytes_of(&globals));
        let mut lights: Vec<GpuLight> = view
            .lights
            .iter()
            .map(|l| GpuLight {
                color: l.color.to_array(),
                kind: match l.kind {
                    super::LightKind::Directional => 1,
                    super::LightKind::Point => 2,
                    super::LightKind::Spot => 3,
                    _ => 0,
                },
                position: l.position.to_array(),
                range: l.range,
                direction: l.direction.to_array(),
                cos_outer: l.cos_outer,
                cos_inner: l.cos_inner,
                _pad: [0.0; 3],
            })
            .collect();
        // A storage buffer can't be bound empty.
        lights.push(Zeroable::zeroed());
        let mut objects: Vec<GpuObject> = view
            .objects
            .iter()
            .map(|o| {
                let m = &o.material;
                GpuObject {
                    model: o.model.to_cols_array(),
                    normal_matrix: o.model.inverse().transpose().to_cols_array(),
                    color: [m.color[0], m.color[1], m.color[2], m.color[3] * m.opacity],
                    emissive: m.emissive,
                    metalness: m.metalness,
                    roughness: m.roughness,
                    _pad: [0.0; 3],
                }
            })
            .collect();
        objects.push(Zeroable::zeroed());
        let mut remade = self.lights.write(device, queue, bytemuck::cast_slice(&lights));
        remade |= self.objects.write(device, queue, bytemuck::cast_slice(&objects));
        if remade || self.frame_bind.is_none() {
            self.frame_bind = Some(device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("scene3d frame"),
                layout: &self.frame_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: self.globals.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: self.lights.buffer().as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: self.objects.buffer().as_entire_binding(),
                    },
                ],
            }));
        }

        // The uniforms of every material, each at an offset of its own.
        let mut uniform_bytes = Vec::new();
        let mut offsets = Vec::with_capacity(view.objects.len());
        for o in &view.objects {
            offsets.push(uniform_bytes.len() as u32);
            if o.material.shader.as_ref().is_some_and(|s| s.uniforms.is_some()) {
                uniform_bytes.extend_from_slice(&o.material.uniforms);
                let padded = uniform_bytes.len().div_ceil(self.align as usize) * self.align as usize;
                uniform_bytes.resize(padded, 0);
            }
        }
        // As big as the biggest block can be read past its offset.
        uniform_bytes.resize(uniform_bytes.len() + 256, 0);
        self.uniforms.write(device, queue, &uniform_bytes);

        // Opaque things in any order, then those that are seen through from the farthest.
        let depth_of = |o: &super::ObjectView| (view_matrix * o.model.w_axis).z;
        let see_through = |o: &super::ObjectView| {
            let m = &o.material;
            m.transparent || m.opacity < 1.0 || m.color[3] < 1.0
        };
        let mut order: Vec<usize> = (0..view.objects.len()).collect();
        order.sort_by(|&a, &b| {
            let (oa, ob) = (&view.objects[a], &view.objects[b]);
            see_through(oa)
                .cmp(&see_through(ob))
                .then_with(|| match see_through(oa) {
                    true => depth_of(oa).total_cmp(&depth_of(ob)),
                    false => std::cmp::Ordering::Equal,
                })
        });

        // Everything the pass needs is made before it starts.
        struct Draw<'a> {
            index: u32,
            pipeline: wgpu::RenderPipeline,
            user: Option<wgpu::BindGroup>,
            map: u64,
            mesh: &'a Arc<MeshData>,
            offset: u32,
        }
        let mut draws = Vec::with_capacity(order.len());
        for &i in &order {
            let o = &view.objects[i];
            let m = &o.material;
            let shader = m.shader.clone().unwrap_or_else(|| STANDARD.clone());
            let pipeline = self.pipeline(device, &shader, see_through(o), m.double_sided);
            let user = shader.uniforms.is_some() || !shader.textures.is_empty();
            let user = match user {
                true => {
                    let views: Vec<wgpu::TextureView> = m
                        .textures
                        .iter()
                        .map(|t| self.pictures.view(device, queue, t.as_ref()).clone())
                        .collect();
                    let views: Vec<&wgpu::TextureView> = views.iter().collect();
                    let layout = &self.materials[&shader.id].user;
                    Some(gpu::user_bind_group(device, layout, &shader, self.uniforms.buffer(), &views, &self.sampler))
                }
                false => None,
            };
            let map = m.map.as_ref().map_or(0, |p| p.id);
            if !self.maps.contains_key(&map) {
                let texture = self.pictures.view(device, queue, m.map.as_ref()).clone();
                let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("scene3d map"),
                    layout: &self.map_layout,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(&texture),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::Sampler(&self.sampler),
                        },
                    ],
                });
                self.maps.insert(map, bind);
            }
            self.mesh(device, &o.mesh);
            draws.push(Draw {
                index: i as u32,
                pipeline,
                user,
                map,
                mesh: &o.mesh,
                offset: offsets[i],
            });
        }
        let empty = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("scene3d nothing"),
            layout: &self.materials[&STANDARD.id].user,
            entries: &[],
        });

        let targets = self.targets.as_ref().expect("just made");
        let [r, g, b, a] = view.background;
        {
            let mut pass = frame.encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("scene3d"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &targets.light,
                    depth_slice: None,
                    resolve_target: Some(&targets.resolved),
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: (r * a) as f64,
                            g: (g * a) as f64,
                            b: (b * a) as f64,
                            a: a as f64,
                        }),
                        store: wgpu::StoreOp::Discard,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &targets.depth,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Discard,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_bind_group(0, self.frame_bind.as_ref(), &[]);
            for d in &draws {
                let mesh = &self.meshes[&d.mesh.id];
                pass.set_pipeline(&d.pipeline);
                match &d.user {
                    Some(user) => {
                        let offsets: &[u32] = if user_has_uniforms(&view.objects[d.index as usize]) {
                            &[d.offset]
                        } else {
                            &[]
                        };
                        pass.set_bind_group(1, user, offsets);
                    }
                    None => pass.set_bind_group(1, &empty, &[]),
                }
                pass.set_bind_group(2, &self.maps[&d.map], &[]);
                pass.set_vertex_buffer(0, mesh.vertices.slice(..));
                pass.set_index_buffer(mesh.indices.slice(..), wgpu::IndexFormat::Uint32);
                pass.draw_indexed(0..mesh.count, 0, d.index..d.index + 1);
            }
        }

        let mut pass = frame.begin_pass(None);
        pass.set_pipeline(&self.finish_pipeline);
        pass.set_bind_group(0, &targets.finish, &[]);
        pass.draw(0..3, 0..1);
    }
}

fn user_has_uniforms(o: &super::ObjectView) -> bool {
    o.material.shader.as_ref().is_some_and(|s| s.uniforms.is_some())
}

impl SpacePaint {
    /// Lets go of what was made for meshes, shaders and pictures nobody has any more.
    fn retain(&mut self) {
        self.meshes.retain(|_, m| m.of.strong_count() > 0);
        self.materials.retain(|_, m| m.of.strong_count() > 0);
        self.pictures.retain();
        let pictures = &self.pictures;
        self.maps.retain(|&id, _| id == 0 || pictures.has(id));
    }

    fn mesh(&mut self, device: &wgpu::Device, mesh: &Arc<MeshData>) {
        use wgpu::util::DeviceExt;
        self.meshes.entry(mesh.id).or_insert_with(|| Mesh {
            of: Arc::downgrade(mesh),
            vertices: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("scene3d vertices"),
                contents: bytemuck::cast_slice(&mesh.vertices),
                usage: wgpu::BufferUsages::VERTEX,
            }),
            indices: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("scene3d indices"),
                contents: bytemuck::cast_slice(&mesh.indices),
                usage: wgpu::BufferUsages::INDEX,
            }),
            count: mesh.indices.len() as u32,
        });
    }

    fn pipeline(&mut self, device: &wgpu::Device, shader: &Arc<Shader>, see_through: bool, both_sides: bool) -> wgpu::RenderPipeline {
        // The standard material is there for the empty `@group(1)` of the others.
        if !self.materials.contains_key(&STANDARD.id) && shader.id != STANDARD.id {
            self.pipeline(device, &STANDARD.clone(), false, false);
        }
        let material = self.materials.entry(shader.id).or_insert_with(|| Material {
            of: Arc::downgrade(shader),
            user: gpu::user_layout(device, shader),
            pipelines: HashMap::new(),
        });
        if let Some(p) = material.pipelines.get(&(see_through, both_sides)) {
            return p.clone();
        }
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("scene3d material"),
            source: wgpu::ShaderSource::Wgsl(shader.code.as_str().into()),
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("scene3d material"),
            bind_group_layouts: &[Some(&self.frame_layout), Some(&material.user), Some(&self.map_layout)],
            immediate_size: 0,
        });
        let blend = wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING;
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("scene3d material"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("fs_vertex_main"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: (STRIDE * 4) as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3, 2 => Float32x2],
                })],
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs_fragment_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: LIGHT_FORMAT,
                    blend: Some(blend),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                cull_mode: (!both_sides).then_some(wgpu::Face::Back),
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: Some(!see_through),
                depth_compare: Some(wgpu::CompareFunction::LessEqual),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: wgpu::MultisampleState {
                count: SAMPLES,
                ..Default::default()
            },
            multiview_mask: None,
            cache: None,
        });
        material.pipelines.insert((see_through, both_sides), pipeline.clone());
        pipeline
    }

    fn make_targets(&self, device: &wgpu::Device, size: (u32, u32)) -> Targets {
        let texture = |label, format, samples, usage| {
            device
                .create_texture(&wgpu::TextureDescriptor {
                    label: Some(label),
                    size: wgpu::Extent3d {
                        width: size.0.max(1),
                        height: size.1.max(1),
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: samples,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage,
                    view_formats: &[],
                })
                .create_view(&Default::default())
        };
        let attachment = wgpu::TextureUsages::RENDER_ATTACHMENT;
        let light = texture("scene3d light", LIGHT_FORMAT, SAMPLES, attachment);
        let resolved = texture(
            "scene3d resolved",
            LIGHT_FORMAT,
            1,
            attachment | wgpu::TextureUsages::TEXTURE_BINDING,
        );
        let depth = texture("scene3d depth", DEPTH_FORMAT, SAMPLES, attachment);
        let finish = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("scene3d finish"),
            layout: &self.finish_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&resolved),
                },
            ],
        });
        let _ = self.format;
        Targets {
            size,
            light,
            resolved,
            depth,
            finish,
        }
    }
}

fn uniform_entry(binding: u32, visibility: wgpu::ShaderStages) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

fn texture_entry(binding: u32, filterable: bool) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable },
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    }
}

fn sampler_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
        count: None,
    }
}

/// Light (tone mapped where it is made) to the colors of the box: sRGB, premultiplied.
const FINISH: &str = r#"
@group(0) @binding(0) var light: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
}

fn encode(light: vec3f) -> vec3f {
    let l = clamp(light, vec3f(0.0), vec3f(1.0));
    return select(1.055 * pow(l, vec3f(1.0 / 2.4)) - 0.055, l * 12.92, l <= vec3f(0.0031308));
}

@fragment
fn fs(@builtin(position) at: vec4f) -> @location(0) vec4f {
    let texel = textureLoad(light, vec2i(at.xy), 0);
    let a = clamp(texel.a, 0.0, 1.0);
    if a <= 0.0 {
        return vec4f(0.0);
    }
    return vec4f(encode(texel.rgb / a) * a, a);
}
"#;
