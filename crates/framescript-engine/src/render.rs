//! Drawing scenes offscreen, without a window: for the command line, exporting and tests.
//!
//! For video, the picture is turned into YUV 4:2:0 on the GPU (BT.709, video range, as encoders
//! want it): what comes back is less than half the size of RGBA, and the encoder has nothing to
//! convert.

use anti_webui_core::scene::Scene;
use anti_webui_wgpu::wgpu;
use anti_webui_wgpu::{Gpu, GpuError, Renderer};
use std::path::Path;

/// Pixels of Y each invocation of the shader writes, in a row and in a column.
const BLOCK: (u32, u32) = (8, 2);
/// Invocations in a workgroup, in a row and in a column.
const GROUP: (u32, u32) = (8, 8);

const YUV_SHADER: &str = r#"
struct Params { width: u32, height: u32, stride: u32, rows: u32 }

@group(0) @binding(0) var picture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> planes: array<u32>;
@group(0) @binding(2) var<uniform> p: Params;

// Past the edge is the edge: sizes are made even, and rows long enough for whole words.
fn at(x: u32, y: u32) -> vec3<f32> {
    let c = vec2<i32>(i32(min(x, p.width - 1u)), i32(min(y, p.height - 1u)));
    return textureLoad(picture, c, 0).rgb;
}

fn luma(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn byte(v: f32) -> u32 {
    return u32(clamp(round(v), 0.0, 255.0));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let x0 = id.x * 8u;
    let y0 = id.y * 2u;
    if (x0 >= p.stride || y0 >= p.rows) {
        return;
    }
    for (var row = 0u; row < 2u; row++) {
        for (var half = 0u; half < 2u; half++) {
            var word = 0u;
            for (var k = 0u; k < 4u; k++) {
                let c = at(x0 + half * 4u + k, y0 + row);
                word |= byte(16.0 + 219.0 * luma(c)) << (8u * k);
            }
            planes[((y0 + row) * p.stride + x0 + half * 4u) / 4u] = word;
        }
    }
    var u = 0u;
    var v = 0u;
    for (var k = 0u; k < 4u; k++) {
        let x = x0 + 2u * k;
        let c = (at(x, y0) + at(x + 1u, y0) + at(x, y0 + 1u) + at(x + 1u, y0 + 1u)) * 0.25;
        let l = luma(c);
        u |= byte(128.0 + 224.0 * (c.b - l) / 1.8556) << (8u * k);
        v |= byte(128.0 + 224.0 * (c.r - l) / 1.5748) << (8u * k);
    }
    let chroma = p.stride / 2u;
    let luma_bytes = p.stride * p.rows;
    let i = (y0 / 2u) * chroma + x0 / 2u;
    planes[(luma_bytes + i) / 4u] = u;
    planes[(luma_bytes + chroma * (p.rows / 2u) + i) / 4u] = v;
}
"#;

pub struct OffscreenRenderer {
    gpu: Gpu,
    renderer: Renderer,
    /// What was drawn into last, kept for the next frame of the same size.
    target: Option<Target>,
    yuv: Option<Yuv>,
}

/// A picture to draw into, and what it is read back through.
struct Target {
    texture: wgpu::Texture,
    view: wgpu::TextureView,
    /// What the RGBA is read back through.
    readback: Option<wgpu::Buffer>,
    planes: Option<Planar>,
}

/// What the shader writes the planes into, and what they are read back through.
struct Planar {
    buffer: wgpu::Buffer,
    readback: wgpu::Buffer,
    bind: wgpu::BindGroup,
}

/// The shader that makes YUV.
struct Yuv {
    pipeline: wgpu::ComputePipeline,
    layout: wgpu::BindGroupLayout,
    params: wgpu::Buffer,
}

/// How the planes of a picture of `width` × `height` lie in what the shader writes: even sizes,
/// and rows of Y a multiple of 8 long, so that every row of every plane is whole words.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Planes {
    width: u32,
    height: u32,
    stride: u32,
}

impl Planes {
    fn of(width: u32, height: u32) -> Planes {
        let even = |n: u32| n.div_ceil(2) * 2;
        Planes {
            width: even(width),
            height: even(height),
            stride: width.div_ceil(BLOCK.0) * BLOCK.0,
        }
    }

    fn bytes(&self) -> u64 {
        (self.stride * self.height) as u64 * 3 / 2
    }
}

/// The size YUV 4:2:0 of a picture of `width` × `height` comes out as: made even.
pub fn yuv_size(width: u32, height: u32) -> (u32, u32) {
    let p = Planes::of(width, height);
    (p.width, p.height)
}

impl OffscreenRenderer {
    pub fn new() -> Result<Self, GpuError> {
        let gpu = Gpu::headless()?;
        let renderer = Renderer::new(&gpu.device, wgpu::TextureFormat::Rgba8Unorm);
        Ok(Self {
            gpu,
            renderer,
            target: None,
            yuv: None,
        })
    }

    /// Tightly packed RGBA8 pixels of `scene`.
    pub fn rgba(&mut self, scene: &Scene) -> Vec<u8> {
        let mut target = self.draw(scene);
        let (w, h) = (target.texture.width(), target.texture.height());
        let padded = (w * 4).div_ceil(256) * 256;
        let device = &self.gpu.device;
        let buffer = target.readback.get_or_insert_with(|| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("rgba readback"),
                size: (padded * h) as u64,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            })
        });
        let mut encoder = device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            target.texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded),
                    rows_per_image: Some(h),
                },
            },
            target.texture.size(),
        );
        self.gpu.queue.submit([encoder.finish()]);
        let mut out = Vec::with_capacity((w * h * 4) as usize);
        read(&self.gpu, buffer, |data| {
            for row in data.chunks_exact(padded as usize) {
                out.extend_from_slice(&row[..(w * 4) as usize]);
            }
        });
        self.target = Some(target);
        out
    }

    /// The pixels of `scene` as YUV 4:2:0 in three planes one after another (`yuv420p`), at
    /// [`yuv_size`].
    pub fn yuv420(&mut self, scene: &Scene) -> Vec<u8> {
        let mut target = self.draw(scene);
        let (w, h) = (target.texture.width(), target.texture.height());
        let planes = Planes::of(w, h);
        let device = &self.gpu.device;
        let yuv = self.yuv.get_or_insert_with(|| Yuv::new(device));
        let Planar {
            buffer,
            readback,
            bind,
        } = target.planes.get_or_insert_with(|| {
            let buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("yuv planes"),
                size: planes.bytes(),
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            });
            let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("yuv"),
                layout: &yuv.layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&target.view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: buffer.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: yuv.params.as_entire_binding(),
                    },
                ],
            });
            let readback = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("yuv readback"),
                size: planes.bytes(),
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
            Planar {
                buffer,
                readback,
                bind,
            }
        });
        let params: Vec<u8> = [w, h, planes.stride, planes.height]
            .iter()
            .flat_map(|v| v.to_le_bytes())
            .collect();
        self.gpu.queue.write_buffer(&yuv.params, 0, &params);
        let mut encoder = device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("yuv"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&yuv.pipeline);
            pass.set_bind_group(0, &*bind, &[]);
            pass.dispatch_workgroups(
                (planes.stride / BLOCK.0).div_ceil(GROUP.0),
                (planes.height / BLOCK.1).div_ceil(GROUP.1),
                1,
            );
        }
        encoder.copy_buffer_to_buffer(buffer, 0, readback, 0, planes.bytes());
        self.gpu.queue.submit([encoder.finish()]);

        // The rows without what was added to make them whole words.
        let (pw, ph, stride) = (
            planes.width as usize,
            planes.height as usize,
            planes.stride as usize,
        );
        let mut out = Vec::with_capacity(pw * ph * 3 / 2);
        read(&self.gpu, readback, |data| {
            let (luma, chroma) = data.split_at(stride * ph);
            for row in luma.chunks_exact(stride) {
                out.extend_from_slice(&row[..pw]);
            }
            for row in chroma.chunks_exact(stride / 2) {
                out.extend_from_slice(&row[..pw / 2]);
            }
        });
        self.target = Some(target);
        out
    }

    /// Draws `scene` into the target, made again if its size changed.
    fn draw(&mut self, scene: &Scene) -> Target {
        let (w, h) = (scene.width.max(1), scene.height.max(1));
        let target = match self.target.take() {
            Some(t) if (t.texture.width(), t.texture.height()) == (w, h) => t,
            _ => {
                let texture = self.gpu.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("offscreen"),
                    size: wgpu::Extent3d {
                        width: w,
                        height: h,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: self.renderer.format(),
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                        | wgpu::TextureUsages::COPY_SRC
                        | wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                });
                let view = texture.create_view(&Default::default());
                Target {
                    texture,
                    view,
                    readback: None,
                    planes: None,
                }
            }
        };
        let mut encoder = self.gpu.device.create_command_encoder(&Default::default());
        self.renderer.render(
            &self.gpu.device,
            &self.gpu.queue,
            &mut encoder,
            &target.view,
            scene,
        );
        self.gpu.queue.submit([encoder.finish()]);
        target
    }
}

impl Yuv {
    fn new(device: &wgpu::Device) -> Yuv {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("yuv"),
            source: wgpu::ShaderSource::Wgsl(YUV_SHADER.into()),
        });
        let entry = |binding, ty| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty,
            count: None,
        };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("yuv"),
            entries: &[
                entry(
                    0,
                    wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                ),
                entry(
                    1,
                    wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                ),
                entry(
                    2,
                    wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                ),
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("yuv"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("yuv"),
            layout: Some(&pipeline_layout),
            module: &module,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });
        let params = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("yuv params"),
            size: 16,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        Yuv {
            pipeline,
            layout,
            params,
        }
    }
}

/// Waits for `buffer` to be written and hands what is in it to `f`.
fn read(gpu: &Gpu, buffer: &wgpu::Buffer, f: impl FnOnce(&[u8])) {
    let slice = buffer.slice(..);
    slice.map_async(wgpu::MapMode::Read, |_| {});
    let _ = gpu.device.poll(wgpu::PollType::wait_indefinitely());
    {
        let data = slice
            .get_mapped_range()
            .expect("the readback buffer is mapped");
        f(&data);
    }
    buffer.unmap();
}

pub fn write_png(
    path: &Path,
    width: u32,
    height: u32,
    rgba: &[u8],
) -> Result<(), Box<dyn std::error::Error>> {
    let file = std::fs::File::create(path)?;
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.write_header()?.write_image_data(rgba)?;
    Ok(())
}
