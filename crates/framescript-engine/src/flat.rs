//! `<Shader>`: a box all of whose pixels a composition's WGSL makes (see [`crate::shader`]).
//!
//! The composition keeps what the box is drawn from ([`FlatBox`]) and hands it to the scene as a
//! [`FlatFrame`] whenever it changes; [`FlatPaint`] draws that, on whatever device draws the scene.

use crate::gpu::{self, Growing, Pictures};
use crate::shader::{FLAT_GLOBALS, Now, Shader, Source, Texture};
use anti_webui_wgpu::canvas::{GpuFrame, GpuInit, GpuPaint};
use anti_webui_wgpu::wgpu;
use std::sync::Arc;

/// What the composition knows of a `<Shader>` box.
#[derive(Default)]
pub struct FlatBox {
    pub shader: Option<Arc<Shader>>,
    pub uniforms: Vec<u8>,
    /// By the order of the shader's textures.
    pub textures: Vec<Option<Source>>,
    /// Seconds and the frame, of the clip.
    pub time: [f32; 2],
    /// Whether it changed since it was last handed to the scene.
    pub changed: bool,
}

impl FlatBox {
    pub fn set_shader(&mut self, shader: Arc<Shader>) {
        if self.shader.as_ref().is_some_and(|s| Arc::ptr_eq(s, &shader)) {
            return;
        }
        self.uniforms = shader.blank_uniforms();
        self.textures = vec![None; shader.textures.len()];
        self.shader = Some(shader);
        self.changed = true;
    }

    /// What the scene is to show, if there is anything.
    pub fn frame(&self, now: &impl Now) -> Option<FlatFrame> {
        Some(FlatFrame {
            shader: self.shader.clone()?,
            uniforms: self.uniforms.clone(),
            textures: self.textures.iter().map(|t| t.as_ref()?.texture(now)).collect(),
            time: self.time,
        })
    }
}

/// What a `<Shader>` box is drawn from, as it goes with the scene.
pub struct FlatFrame {
    pub shader: Arc<Shader>,
    pub uniforms: Vec<u8>,
    pub textures: Vec<Option<Texture>>,
    pub time: [f32; 2],
}

#[derive(Clone)]
pub struct FlatProps(pub Arc<FlatFrame>);

impl PartialEq for FlatProps {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

/// Draws a `<Shader>` box on one device.
pub struct FlatPaint {
    globals: wgpu::Buffer,
    globals_bind: wgpu::BindGroup,
    globals_layout: wgpu::BindGroupLayout,
    /// For the shader it last drew with.
    pipeline: Option<Pipeline>,
    uniforms: Growing,
    pictures: Pictures,
    sampler: wgpu::Sampler,
    format: wgpu::TextureFormat,
}

struct Pipeline {
    shader: u64,
    pipeline: wgpu::RenderPipeline,
    user: wgpu::BindGroupLayout,
}

impl GpuPaint for FlatPaint {
    type Props = FlatProps;

    fn new(gpu: &GpuInit<'_>) -> Self {
        let device = gpu.device;
        let globals = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("framescript fs"),
            size: FLAT_GLOBALS,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let globals_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("framescript fs"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let globals_bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("framescript fs"),
            layout: &globals_layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: globals.as_entire_binding(),
            }],
        });
        Self {
            globals,
            globals_bind,
            globals_layout,
            pipeline: None,
            uniforms: Growing::new(device, "framescript uniforms", wgpu::BufferUsages::UNIFORM),
            pictures: Pictures::new(device, gpu.queue),
            sampler: gpu::sampler(device),
            format: gpu.format,
        }
    }

    fn render(&mut self, props: &FlatProps, frame: &mut GpuFrame<'_>) {
        let f = &*props.0;
        let device = frame.device;
        if self.pipeline.as_ref().is_none_or(|p| p.shader != f.shader.id) {
            self.pipeline = Some(self.make_pipeline(device, &f.shader));
        }
        let globals = [frame.size.0 as f32, frame.size.1 as f32, f.time[0], f.time[1]];
        frame.queue.write_buffer(&self.globals, 0, bytemuck::cast_slice(&globals));
        self.uniforms.write(device, frame.queue, &f.uniforms);
        self.pictures.retain();
        let views: Vec<wgpu::TextureView> = f
            .textures
            .iter()
            .map(|t| self.pictures.view(device, frame.queue, frame.encoder, t.as_ref()).clone())
            .collect();
        let views: Vec<&wgpu::TextureView> = views.iter().collect();
        let p = self.pipeline.as_ref().expect("just made");
        let user = gpu::user_bind_group(device, &p.user, &f.shader, self.uniforms.buffer(), &views, &self.sampler);
        let offsets: &[u32] = if f.shader.uniforms.is_some() { &[0] } else { &[] };

        let mut pass = frame.begin_pass(Some(wgpu::Color::TRANSPARENT));
        pass.set_pipeline(&p.pipeline);
        pass.set_bind_group(0, &self.globals_bind, &[]);
        pass.set_bind_group(1, &user, offsets);
        pass.draw(0..3, 0..1);
    }
}

impl FlatPaint {
    fn make_pipeline(&self, device: &wgpu::Device, shader: &Shader) -> Pipeline {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("<Shader>"),
            source: wgpu::ShaderSource::Wgsl(shader.code.as_str().into()),
        });
        let user = gpu::user_layout(device, shader);
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("<Shader>"),
            bind_group_layouts: &[Some(&self.globals_layout), Some(&user)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("<Shader>"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("fs_vertex"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                // The one that calls `shade`, or the composition's own.
                entry_point: shader.hooks.shade.then_some("fs_fragment"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: self.format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        Pipeline {
            shader: shader.id,
            pipeline,
            user,
        }
    }
}
