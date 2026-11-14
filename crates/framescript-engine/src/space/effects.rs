//! What is done to all of a scene once it is drawn: effects written in WGSL, and bloom.
//!
//! The scene is light, premultiplied, in half floats. Each effect reads what the one before made and
//! writes into the other of two textures; the last one is what the box shows. Bloom is the usual
//! chain: what is brighter than the threshold is taken into a texture of half the size, halved again
//! a few times, and spread back up, each size adding to the next bigger one, before it is added to
//! the scene.

use super::{Bloom, EffectView};
use crate::gpu::{self, Growing, Pictures};
use crate::shader::Shader;
use anti_webui_wgpu::wgpu;
use bytemuck::{Pod, Zeroable};
use std::collections::HashMap;
use std::sync::{Arc, Weak};

const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
/// How far apart what each pass reads is, in the buffer of their numbers.
const STRIDE: u64 = 256;

pub struct Effects {
    sampler: wgpu::Sampler,
    /// `fs`, the scene so far, and its sampler.
    layout: wgpu::BindGroupLayout,
    /// The numbers of every pass (`fs` of an effect, or what a pass of bloom goes by), each at an
    /// offset of its own.
    numbers: Growing,
    /// The uniforms of the effects, each at an offset of its own.
    uniforms: Growing,
    align: u32,
    shaders: HashMap<u64, Pipeline>,
    /// What effects write into, in turn.
    turns: Option<([Target; 2], (u32, u32))>,
    bloom: Option<BloomPass>,
}

struct Pipeline {
    of: Weak<Shader>,
    pipeline: wgpu::RenderPipeline,
    user: wgpu::BindGroupLayout,
}

struct Target {
    view: wgpu::TextureView,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Numbers {
    /// Of an effect: the size of the scene, the time and the frame. Of bloom: the size of a texel of
    /// what is read, the threshold, and the strength or the radius.
    a: [f32; 4],
    _pad: [f32; 60],
}

impl Effects {
    pub fn new(device: &wgpu::Device) -> Self {
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene3d effect"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: true,
                        min_binding_size: wgpu::BufferSize::new(16),
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        Self {
            sampler: gpu::sampler(device),
            layout,
            numbers: Growing::new(device, "scene3d effect numbers", wgpu::BufferUsages::UNIFORM),
            uniforms: Growing::new(device, "scene3d effect uniforms", wgpu::BufferUsages::UNIFORM),
            align: device.limits().min_uniform_buffer_offset_alignment.max(16),
            shaders: HashMap::new(),
            turns: None,
            bloom: None,
        }
    }

    /// Does `effects` to the scene in `input`, of `size`, at `time` (seconds and frame); returns
    /// what has the result, or `None` if there are no effects and it is `input` itself.
    #[allow(clippy::too_many_arguments)]
    pub fn apply(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        pictures: &mut Pictures,
        input: &wgpu::TextureView,
        size: (u32, u32),
        effects: &[EffectView],
        time: [f32; 2],
    ) -> Option<wgpu::TextureView> {
        self.shaders.retain(|_, p| p.of.strong_count() > 0);
        if effects.is_empty() {
            return None;
        }
        if self.turns.as_ref().is_none_or(|(_, s)| *s != size) {
            let target = || Target {
                view: texture(device, "scene3d effect", size, 1, wgpu::TextureUsages::RENDER_ATTACHMENT)
                    .create_view(&Default::default()),
            };
            self.turns = Some(([target(), target()], size));
        }

        // The numbers of every pass, and the uniforms of every effect, before any is drawn.
        let mut numbers: Vec<Numbers> = Vec::new();
        let mut uniforms: Vec<u8> = Vec::new();
        let mut plans = Vec::new();
        for e in effects {
            match e {
                EffectView::Shader { shader, uniforms: u, .. } => {
                    let at = numbers.len();
                    numbers.push(Numbers {
                        a: [size.0 as f32, size.1 as f32, time[0], time[1]],
                        _pad: [0.0; 60],
                    });
                    let offset = uniforms.len() as u32;
                    uniforms.extend_from_slice(u);
                    uniforms.resize(uniforms.len().div_ceil(self.align as usize) * self.align as usize, 0);
                    self.pipeline(device, shader);
                    plans.push((at, offset));
                }
                EffectView::Bloom(b) => {
                    let at = numbers.len();
                    let bloom = self.bloom_for(device, size);
                    numbers.extend(bloom.numbers(b, size));
                    plans.push((at, 0));
                }
            }
        }
        uniforms.resize(uniforms.len() + 256, 0);
        self.numbers.write(device, queue, bytemuck::cast_slice(&numbers));
        self.uniforms.write(device, queue, &uniforms);

        let (turns, _) = self.turns.as_ref().expect("just made");
        let mut from = input.clone();
        for (i, (e, (at, offset))) in effects.iter().zip(plans).enumerate() {
            let to = &turns[i % 2].view;
            let numbers_at = |n: usize| (at + n) as u32 * STRIDE as u32;
            match e {
                EffectView::Shader { shader, textures, .. } => {
                    let views: Vec<wgpu::TextureView> = textures
                        .iter()
                        .map(|t| pictures.view(device, queue, encoder, t.as_ref()).clone())
                        .collect();
                    let views: Vec<&wgpu::TextureView> = views.iter().collect();
                    let p = &self.shaders[&shader.id];
                    let user = gpu::user_bind_group(device, &p.user, shader, self.uniforms.buffer(), &views, &self.sampler);
                    let input = self.bind(device, &from);
                    let mut pass = begin(encoder, to, true);
                    pass.set_pipeline(&p.pipeline);
                    pass.set_bind_group(0, &input, &[numbers_at(0)]);
                    let offsets: &[u32] = if shader.uniforms.is_some() { &[offset] } else { &[] };
                    pass.set_bind_group(1, &user, offsets);
                    pass.draw(0..3, 0..1);
                }
                EffectView::Bloom(_) => {
                    let bloom = self.bloom.as_ref().expect("made above");
                    bloom.draw(device, encoder, self, &from, to, at);
                }
            }
            from = to.clone();
        }
        Some(from)
    }

    fn bind(&self, device: &wgpu::Device, view: &wgpu::TextureView) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("scene3d effect"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                        buffer: self.numbers.buffer(),
                        offset: 0,
                        size: wgpu::BufferSize::new(16),
                    }),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        })
    }

    fn pipeline(&mut self, device: &wgpu::Device, shader: &Arc<Shader>) {
        if self.shaders.contains_key(&shader.id) {
            return;
        }
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("scene3d effect"),
            source: wgpu::ShaderSource::Wgsl(shader.code.as_str().into()),
        });
        let user = gpu::user_layout(device, shader);
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("scene3d effect"),
            bind_group_layouts: &[Some(&self.layout), Some(&user)],
            immediate_size: 0,
        });
        let pipeline = full_screen(device, &layout, &module, "fs_vertex", "fs_fragment", None);
        self.shaders.insert(
            shader.id,
            Pipeline {
                of: Arc::downgrade(shader),
                pipeline,
                user,
            },
        );
    }

    fn bloom_for(&mut self, device: &wgpu::Device, size: (u32, u32)) -> &BloomPass {
        if self.bloom.as_ref().is_none_or(|b| b.size != size) {
            self.bloom = Some(BloomPass::new(device, &self.layout, size));
        }
        self.bloom.as_ref().expect("just made")
    }
}

/// The chain of textures and the pipelines of bloom.
struct BloomPass {
    size: (u32, u32),
    /// Half the size of the scene, then half of that, and so on.
    levels: Vec<(wgpu::TextureView, (u32, u32))>,
    prefilter: wgpu::RenderPipeline,
    down: wgpu::RenderPipeline,
    up: wgpu::RenderPipeline,
    combine: wgpu::RenderPipeline,
    /// The bloom, for `combine`, which reads the scene in group 0.
    second: wgpu::BindGroupLayout,
}

impl BloomPass {
    fn new(device: &wgpu::Device, layout: &wgpu::BindGroupLayout, size: (u32, u32)) -> Self {
        let mut levels = Vec::new();
        let (mut w, mut h) = ((size.0 / 2).max(1), (size.1 / 2).max(1));
        let count = (32 - w.min(h).max(1).leading_zeros()).clamp(1, 6) as usize;
        let tex = texture(device, "scene3d bloom", (w, h), count as u32, wgpu::TextureUsages::RENDER_ATTACHMENT);
        for level in 0..count {
            let view = tex.create_view(&wgpu::TextureViewDescriptor {
                base_mip_level: level as u32,
                mip_level_count: Some(1),
                ..Default::default()
            });
            levels.push((view, (w, h)));
            (w, h) = ((w / 2).max(1), (h / 2).max(1));
        }
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("scene3d bloom"),
            source: wgpu::ShaderSource::Wgsl(BLOOM.into()),
        });
        let second = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene3d bloom"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            }],
        });
        let one = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("scene3d bloom"),
            bind_group_layouts: &[Some(layout)],
            immediate_size: 0,
        });
        let two = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("scene3d bloom"),
            bind_group_layouts: &[Some(layout), Some(&second)],
            immediate_size: 0,
        });
        let add = wgpu::BlendState {
            color: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::One,
                dst_factor: wgpu::BlendFactor::One,
                operation: wgpu::BlendOperation::Add,
            },
            alpha: wgpu::BlendComponent::OVER,
        };
        Self {
            size,
            levels,
            prefilter: full_screen(device, &one, &module, "vs", "prefilter", None),
            down: full_screen(device, &one, &module, "vs", "down", None),
            up: full_screen(device, &one, &module, "vs", "up", Some(add)),
            combine: full_screen(device, &two, &module, "vs", "combine", None),
            second,
        }
    }

    /// The numbers of its passes: the prefilter, each halving, each spreading back, and adding it.
    fn numbers(&self, b: &Bloom, size: (u32, u32)) -> Vec<Numbers> {
        let n = |a: [f32; 4]| Numbers { a, _pad: [0.0; 60] };
        let texel = |(w, h): (u32, u32)| [1.0 / w as f32, 1.0 / h as f32];
        let mut out = vec![n([texel(size)[0], texel(size)[1], b.threshold, 0.0])];
        for (_, s) in &self.levels[..self.levels.len() - 1] {
            out.push(n([texel(*s)[0], texel(*s)[1], 0.0, 0.0]));
        }
        // Spreading from a smaller one: how much of it, which is how far it goes.
        let weight = 0.35 + 0.65 * b.radius;
        for (_, s) in self.levels[1..].iter().rev() {
            out.push(n([texel(*s)[0], texel(*s)[1], 0.0, weight]));
        }
        out.push(n([0.0, 0.0, 0.0, b.strength]));
        out
    }

    fn draw(
        &self,
        device: &wgpu::Device,
        encoder: &mut wgpu::CommandEncoder,
        effects: &Effects,
        input: &wgpu::TextureView,
        output: &wgpu::TextureView,
        at: usize,
    ) {
        let mut pass_number = at;
        let mut run = |pipeline: &wgpu::RenderPipeline, from: &wgpu::TextureView, to: &wgpu::TextureView, clear: bool, extra: Option<&wgpu::BindGroup>| {
            let bind = effects.bind(device, from);
            let mut pass = begin(encoder, to, clear);
            pass.set_pipeline(pipeline);
            pass.set_bind_group(0, &bind, &[(pass_number as u64 * STRIDE) as u32]);
            if let Some(extra) = extra {
                pass.set_bind_group(1, extra, &[]);
            }
            pass.draw(0..3, 0..1);
            pass_number += 1;
        };
        run(&self.prefilter, input, &self.levels[0].0, true, None);
        for w in self.levels.windows(2) {
            run(&self.down, &w[0].0, &w[1].0, true, None);
        }
        for w in self.levels.windows(2).rev() {
            run(&self.up, &w[1].0, &w[0].0, false, None);
        }
        let bloom = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("scene3d bloom"),
            layout: &self.second,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(&self.levels[0].0),
            }],
        });
        run(&self.combine, input, output, true, Some(&bloom));
    }
}

fn texture(device: &wgpu::Device, label: &str, size: (u32, u32), mips: u32, usage: wgpu::TextureUsages) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width: size.0.max(1),
            height: size.1.max(1),
            depth_or_array_layers: 1,
        },
        mip_level_count: mips,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: FORMAT,
        usage: usage | wgpu::TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    })
}

fn begin<'e>(encoder: &'e mut wgpu::CommandEncoder, to: &wgpu::TextureView, clear: bool) -> wgpu::RenderPass<'e> {
    encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some("scene3d effect"),
        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
            view: to,
            depth_slice: None,
            resolve_target: None,
            ops: wgpu::Operations {
                load: if clear { wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT) } else { wgpu::LoadOp::Load },
                store: wgpu::StoreOp::Store,
            },
        })],
        depth_stencil_attachment: None,
        timestamp_writes: None,
        occlusion_query_set: None,
        multiview_mask: None,
    })
}

fn full_screen(
    device: &wgpu::Device,
    layout: &wgpu::PipelineLayout,
    module: &wgpu::ShaderModule,
    vertex: &str,
    fragment: &str,
    blend: Option<wgpu::BlendState>,
) -> wgpu::RenderPipeline {
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("scene3d effect"),
        layout: Some(layout),
        vertex: wgpu::VertexState {
            module,
            entry_point: Some(vertex),
            compilation_options: Default::default(),
            buffers: &[],
        },
        fragment: Some(wgpu::FragmentState {
            module,
            entry_point: Some(fragment),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format: FORMAT,
                blend,
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        primitive: Default::default(),
        depth_stencil: None,
        multisample: Default::default(),
        multiview_mask: None,
        cache: None,
    })
}

/// Bloom: what is brighter than the threshold, halved and spread back up (the filters of Jimenez,
/// "Next Generation Post Processing in Call of Duty: Advanced Warfare", 2014).
const BLOOM: &str = r#"
struct Numbers { texel: vec2f, threshold: f32, amount: f32 }
@group(0) @binding(0) var<uniform> n: Numbers;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var linear: sampler;
@group(1) @binding(0) var bloom: texture_2d<f32>;

struct Varying {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> Varying {
    let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
    var out: Varying;
    out.position = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
    out.uv = uv;
    return out;
}

fn at(uv: vec2f, dx: f32, dy: f32) -> vec3f {
    return textureSampleLevel(source, linear, uv + vec2f(dx, dy) * n.texel, 0.0).rgb;
}

/// Thirteen samples, weighted so that a bright pixel doesn't flicker as it moves.
fn halve(uv: vec2f) -> vec3f {
    let a = at(uv, -2.0, -2.0); let b = at(uv, 0.0, -2.0); let c = at(uv, 2.0, -2.0);
    let d = at(uv, -2.0, 0.0);  let e = at(uv, 0.0, 0.0);  let f = at(uv, 2.0, 0.0);
    let g = at(uv, -2.0, 2.0);  let h = at(uv, 0.0, 2.0);  let i = at(uv, 2.0, 2.0);
    let j = at(uv, -1.0, -1.0); let k = at(uv, 1.0, -1.0);
    let l = at(uv, -1.0, 1.0);  let m = at(uv, 1.0, 1.0);
    return e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
}

@fragment
fn prefilter(in: Varying) -> @location(0) vec4f {
    let c = halve(in.uv);
    // What is over the threshold, with a soft knee below it.
    let peak = max(c.r, max(c.g, c.b));
    let knee = n.threshold * 0.5;
    let soft = clamp(peak - n.threshold + knee, 0.0, 2.0 * knee);
    let over = max(soft * soft / (4.0 * knee + 1e-4), peak - n.threshold);
    return vec4f(c * max(over, 0.0) / max(peak, 1e-4), 1.0);
}

@fragment
fn down(in: Varying) -> @location(0) vec4f {
    return vec4f(halve(in.uv), 1.0);
}

/// A tent of nine samples, from the smaller texture, added to the bigger.
@fragment
fn up(in: Varying) -> @location(0) vec4f {
    let c = (at(in.uv, -1.0, -1.0) + at(in.uv, 1.0, -1.0) + at(in.uv, -1.0, 1.0) + at(in.uv, 1.0, 1.0)
        + (at(in.uv, 0.0, -1.0) + at(in.uv, -1.0, 0.0) + at(in.uv, 1.0, 0.0) + at(in.uv, 0.0, 1.0)) * 2.0
        + at(in.uv, 0.0, 0.0) * 4.0) / 16.0;
    return vec4f(c * n.amount, 0.0);
}

@fragment
fn combine(in: Varying) -> @location(0) vec4f {
    let scene = textureSampleLevel(source, linear, in.uv, 0.0);
    let glow = textureSampleLevel(bloom, linear, in.uv, 0.0).rgb * n.amount;
    // Light added where there was nothing makes that less clear.
    let a = max(scene.a, clamp(max(glow.r, max(glow.g, glow.b)), 0.0, 1.0));
    return vec4f(scene.rgb + glow, a);
}
"#;
