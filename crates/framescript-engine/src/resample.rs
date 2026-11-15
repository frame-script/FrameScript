//! A picture drawn at another size: what the preview shows and what is exported at a scale.
//!
//! A composition is always laid out and painted at the project's own size. AntiWebUI rounds every
//! length to whole pixels of what it paints, so painting at another scale would move things by
//! as much as the rounding comes to; this draws the picture as it is at its size, larger or
//! smaller. Going down, each pixel is the average of what it covers (up to 16 samples a row and a
//! column, bilinear, spread over it); pixel for pixel, it is the picture as it is; going up, it is
//! Catmull-Rom between the texels.

use anti_webui_wgpu::wgpu;

const SHADER: &str = r#"
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

// The most samples a pixel takes in a row or a column, going down.
const MOST: f32 = 16.0;

// Catmull-Rom: how much the texels at -1, 0, 1 and 2 count, `t` past the one at 0.
fn weights(t: f32) -> vec4<f32> {
    let t2 = t * t;
    let t3 = t2 * t;
    return vec4<f32>(
        -0.5 * t3 + t2 - 0.5 * t,
        1.5 * t3 - 2.5 * t2 + 1.0,
        -1.5 * t3 + 2.0 * t2 + 0.5 * t,
        0.5 * t3 - 0.5 * t2,
    );
}

// Between the texels, at `p` in texels.
fn up(p: vec2<f32>) -> vec4<f32> {
    let q = p - 0.5;
    let base = floor(q);
    let wx = weights(q.x - base.x);
    let wy = weights(q.y - base.y);
    let last = vec2<i32>(textureDimensions(picture)) - 1;
    var sum = vec4<f32>(0.0);
    for (var j = 0; j < 4; j++) {
        for (var i = 0; i < 4; i++) {
            let at = clamp(vec2<i32>(base) + vec2<i32>(i - 1, j - 1), vec2<i32>(0), last);
            sum += textureLoad(picture, at, 0) * wx[i] * wy[j];
        }
    }
    // It overshoots at edges.
    return clamp(sum, vec4<f32>(0.0), vec4<f32>(1.0));
}

@fragment
fn fs(in: Out) -> @location(0) vec4<f32> {
    let size = vec2<f32>(textureDimensions(picture));
    // Texels of the picture to a pixel here, in a row and in a column.
    let ratio = abs(vec2<f32>(dpdx(in.uv.x), dpdy(in.uv.y))) * size;
    let p = in.uv * size;
    if (all(ratio < vec2<f32>(1.01))) {
        return up(p);
    }
    let n = clamp(ceil(ratio - 0.01), vec2<f32>(1.0), vec2<f32>(MOST));
    var sum = vec4<f32>(0.0);
    for (var j = 0.0; j < n.y; j += 1.0) {
        for (var i = 0.0; i < n.x; i += 1.0) {
            let at = p + ((vec2<f32>(i, j) + 0.5) / n - 0.5) * ratio;
            sum += textureSampleLevel(picture, picture_sampler, at / size, 0.0);
        }
    }
    return sum / (n.x * n.y);
}
"#;

/// Draws a picture over the viewport of a render pass, whatever its size.
pub struct Resampler {
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
}

impl Resampler {
    /// For drawing into textures of `format`.
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("resample"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("resample"),
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
            label: Some("resample"),
            layout: Some(
                &device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("resample"),
                    bind_group_layouts: &[Some(&layout)],
                    immediate_size: 0,
                }),
            ),
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
                targets: &[Some(format.into())],
            }),
            multiview_mask: None,
            cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("resample"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        Self {
            pipeline,
            layout,
            sampler,
        }
    }

    /// What [`draw`](Self::draw) is given to draw `picture`, a view of a texture that can be
    /// bound.
    pub fn bind(&self, device: &wgpu::Device, picture: &wgpu::TextureView) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("resample"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(picture),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        })
    }

    /// Draws the picture of `bind` over the viewport of `pass`.
    pub fn draw(&self, pass: &mut wgpu::RenderPass<'_>, bind: &wgpu::BindGroup) {
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, bind, &[]);
        pass.draw(0..3, 0..1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anti_webui_wgpu::Gpu;

    const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

    /// `pixels`, `from` in size, drawn at `to`.
    fn resample(gpu: &Gpu, pixels: &[u8], from: (u32, u32), to: (u32, u32)) -> Vec<u8> {
        let (device, queue) = (&gpu.device, &gpu.queue);
        let texture = |(width, height), usage| {
            device.create_texture(&wgpu::TextureDescriptor {
                label: None,
                size: wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: FORMAT,
                usage,
                view_formats: &[],
            })
        };
        let picture = texture(from, wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST);
        queue.write_texture(
            picture.as_image_copy(),
            pixels,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(from.0 * 4),
                rows_per_image: Some(from.1),
            },
            picture.size(),
        );
        let target = texture(to, wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC);
        let resampler = Resampler::new(device, FORMAT);
        let bind = resampler.bind(device, &picture.create_view(&Default::default()));
        let padded = (to.0 * 4).div_ceil(256) * 256;
        let readback = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: (padded * to.1) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = device.create_command_encoder(&Default::default());
        {
            let view = target.create_view(&Default::default());
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            resampler.draw(&mut pass, &bind);
        }
        encoder.copy_texture_to_buffer(
            target.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &readback,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded),
                    rows_per_image: Some(to.1),
                },
            },
            target.size(),
        );
        queue.submit([encoder.finish()]);
        let slice = readback.slice(..);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        let _ = device.poll(wgpu::PollType::wait_indefinitely());
        let data = slice.get_mapped_range().expect("mapped");
        data.chunks_exact(padded as usize)
            .flat_map(|row| row[..(to.0 * 4) as usize].to_vec())
            .collect()
    }

    /// Columns a pixel wide, black and white in turn.
    fn stripes((w, h): (u32, u32)) -> Vec<u8> {
        (0..w * h)
            .flat_map(|i| {
                let v = if i % w % 2 == 0 { 0 } else { 255 };
                [v, v, v, 255]
            })
            .collect()
    }

    fn gpu() -> Option<Gpu> {
        Gpu::headless()
            .inspect_err(|e| eprintln!("no GPU to draw with ({e}); skipped"))
            .ok()
    }

    #[test]
    fn pixel_for_pixel_it_is_the_picture_as_it_is() {
        let Some(gpu) = gpu() else { return };
        let size = (37, 23);
        let pixels: Vec<u8> = (0..size.0 * size.1 * 4u32)
            .map(|i| (i.wrapping_mul(2_654_435_761) >> 24) as u8)
            .collect();
        assert!(resample(&gpu, &pixels, size, size) == pixels);
    }

    #[test]
    fn going_down_each_pixel_is_the_average_of_what_it_covers() {
        let Some(gpu) = gpu() else { return };
        let from = (64, 48);
        // A quarter, and not a whole number of columns to a pixel: sampled at points, the stripes
        // would come out black or white.
        for to in [(16, 12), (21, 16), (27, 20)] {
            let out = resample(&gpu, &stripes(from), from, to);
            let ratio = from.0 as f64 / to.0 as f64;
            for (i, px) in out.chunks_exact(4).enumerate() {
                // How much of the columns it covers are white.
                let x = (i as u32 % to.0) as f64;
                let (a, b) = (x * ratio, (x + 1.0) * ratio);
                let white: f64 = (a.floor() as u32..b.ceil() as u32)
                    .filter(|c| c % 2 == 1)
                    .map(|c| (b.min(c as f64 + 1.0) - a.max(c as f64)).max(0.0))
                    .sum();
                let expected = 255.0 * white / ratio;
                assert!(
                    (px[0] as f64 - expected).abs() <= 26.0,
                    "{to:?}: pixel {i} is {}, not about {expected:.0}",
                    px[0]
                );
            }
        }
    }

    #[test]
    fn going_up_a_color_stays_and_an_edge_doesnt_overshoot() {
        let Some(gpu) = gpu() else { return };
        let from = (8, 6);
        // Left half black, right half white.
        let halves: Vec<u8> = (0..from.0 * from.1)
            .flat_map(|i| if i % from.0 < 4 { [0, 0, 0, 255] } else { [255; 4] })
            .collect();
        let to = (20, 15);
        let out = resample(&gpu, &halves, from, to);
        for y in 0..to.1 {
            let row = &out[(y * to.0 * 4) as usize..][..(to.0 * 4) as usize];
            let gray: Vec<u8> = row.chunks_exact(4).map(|p| p[0]).collect();
            // Far from the edge, the colors are as they were; across it, it only goes up.
            assert!(gray[..5].iter().all(|&g| g == 0), "{gray:?}");
            assert!(gray[15..].iter().all(|&g| g == 255), "{gray:?}");
            assert!(gray.windows(2).all(|w| w[0] <= w[1]), "{gray:?}");
            assert!(row.chunks_exact(4).all(|p| p[3] == 255));
        }
    }
}
