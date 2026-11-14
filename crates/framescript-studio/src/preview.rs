//! The preview: scenes from the worker, drawn in a `gpu_canvas`.
//!
//! The worker paints on its own thread; what reaches the UI thread is only the [`Scene`], which is
//! drawn here by a renderer of the preview's own with the window's GPU device, into a texture the
//! size of the scene, and then put in the middle of the box (the scene is as big as fits, with the
//! project's aspect, so the rest are bars).

use anti_webui::core::scene::Scene;
use anti_webui::gpu::{GpuFrame, GpuInit, GpuPaint, wgpu};
use anti_webui::wgpu::Renderer;
use std::sync::Arc;

/// A scene, compared by the number it came with: comparing scenes themselves would be slower than
/// drawing them.
#[derive(Clone)]
pub struct PreviewFrame {
    pub seq: u64,
    pub scene: Arc<Scene>,
}

impl PartialEq for PreviewFrame {
    fn eq(&self, other: &Self) -> bool {
        self.seq == other.seq
    }
}

pub struct Preview {
    renderer: Renderer,
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    format: wgpu::TextureFormat,
    /// The texture the scene is drawn in, for its size.
    target: Option<((u32, u32), wgpu::TextureView, wgpu::BindGroup)>,
}

const BLIT: &str = r#"
@group(0) @binding(0) var picture: texture_2d<f32>;
@group(0) @binding(1) var picture_sampler: sampler;

struct Out {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

// One triangle over the viewport.
@vertex
fn vs(@builtin(vertex_index) i: u32) -> Out {
    let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    var out: Out;
    out.position = vec4<f32>(uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
    out.uv = uv;
    return out;
}

@fragment
fn fs(in: Out) -> @location(0) vec4<f32> {
    return textureSample(picture, picture_sampler, in.uv);
}
"#;

impl GpuPaint for Preview {
    type Props = Option<PreviewFrame>;

    fn new(gpu: &GpuInit<'_>) -> Self {
        let device = gpu.device;
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("preview"),
            source: wgpu::ShaderSource::Wgsl(BLIT.into()),
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("preview"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("preview"),
            layout: Some(&device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("preview"),
                bind_group_layouts: &[Some(&layout)],
                immediate_size: 0,
            })),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(gpu.format.into())],
            }),
            multiview_mask: None,
            cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("preview"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        Self {
            renderer: Renderer::new(device, gpu.format),
            pipeline,
            layout,
            sampler,
            format: gpu.format,
            target: None,
        }
    }

    fn render(&mut self, props: &Self::Props, frame: &mut GpuFrame<'_>) {
        let black = Some(wgpu::Color::BLACK);
        let Some(shown) = props else {
            frame.begin_pass(black);
            return;
        };
        let scene = &shown.scene;
        let size = (scene.width.max(1), scene.height.max(1));
        if self.target.as_ref().is_none_or(|t| t.0 != size) {
            let texture = frame.device.create_texture(&wgpu::TextureDescriptor {
                label: Some("preview scene"),
                size: wgpu::Extent3d {
                    width: size.0,
                    height: size.1,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: self.format,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            let view = texture.create_view(&Default::default());
            let bind = frame.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("preview"),
                layout: &self.layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(&self.sampler),
                    },
                ],
            });
            self.target = Some((size, view, bind));
        }
        let (_, view, bind) = self.target.as_ref().expect("made above");
        self.renderer
            .render(frame.device, frame.queue, frame.encoder, view, scene);

        // As big as fits in the box with the scene's aspect, in the middle; pixel for pixel when
        // the scene fits as it is, which is what the worker aims for.
        let (bw, bh) = (frame.size.0 as f32, frame.size.1 as f32);
        let (sw, sh) = (size.0 as f32, size.1 as f32);
        let fit = (bw / sw).min(bh / sh);
        let scale = if fit >= 1.0 { 1.0 } else { fit };
        let (w, h) = ((sw * scale).round(), (sh * scale).round());
        let (x, y) = (((bw - w) / 2.0).floor(), ((bh - h) / 2.0).floor());
        let mut pass = frame.begin_pass(black);
        pass.set_viewport(x, y, w.max(1.0), h.max(1.0), 0.0, 1.0);
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, bind, &[]);
        pass.draw(0..3, 0..1);
    }
}
