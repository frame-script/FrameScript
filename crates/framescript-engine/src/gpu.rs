//! What the GPU painters of a composition (`<Shader>` and `<Scene3D>`) share: textures of pictures,
//! and what a shader's `@group(1)` is bound to.
//!
//! The painters go with the scene (AntiWebUI's portable canvases): whatever draws the scene, the
//! preview on the UI thread or a worker of an export, makes them on its own device. Everything here
//! is made again on each.

use crate::shader::{Picture, Shader};
use anti_webui_wgpu::wgpu;
use std::collections::HashMap;
use std::sync::{Arc, Weak};

/// The textures of the pictures a painter has drawn with, kept while the pictures are there.
pub struct Pictures {
    of: HashMap<u64, (Weak<Picture>, wgpu::TextureView)>,
    /// What shows where there is no picture: white, so that it changes nothing it multiplies.
    white: wgpu::TextureView,
}

impl Pictures {
    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue) -> Self {
        let white = upload(device, queue, 1, 1, &[255; 4]);
        Self {
            of: HashMap::new(),
            white,
        }
    }

    /// The texture of `picture`, made the first time. It is sRGB: what is sampled is light.
    pub fn view(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        picture: Option<&Arc<Picture>>,
    ) -> &wgpu::TextureView {
        let Some(p) = picture else {
            return &self.white;
        };
        &self
            .of
            .entry(p.id)
            .or_insert_with(|| {
                let view = upload(device, queue, p.width, p.height, &p.pixels);
                (Arc::downgrade(p), view)
            })
            .1
    }

    /// Whether the texture of the picture `id` is kept.
    pub fn has(&self, id: u64) -> bool {
        self.of.contains_key(&id)
    }

    /// Lets go of the textures of pictures nobody has any more.
    pub fn retain(&mut self) {
        self.of.retain(|_, (p, _)| p.strong_count() > 0);
    }
}

fn upload(device: &wgpu::Device, queue: &wgpu::Queue, width: u32, height: u32, pixels: &[u8]) -> wgpu::TextureView {
    let size = wgpu::Extent3d {
        width,
        height,
        depth_or_array_layers: 1,
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("framescript picture"),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8UnormSrgb,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    queue.write_texture(
        texture.as_image_copy(),
        pixels,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(width * 4),
            rows_per_image: Some(height),
        },
        size,
    );
    texture.create_view(&Default::default())
}

pub fn sampler(device: &wgpu::Device) -> wgpu::Sampler {
    device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("framescript"),
        address_mode_u: wgpu::AddressMode::ClampToEdge,
        address_mode_v: wgpu::AddressMode::ClampToEdge,
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        ..Default::default()
    })
}

/// The layout of what a shader declares in `@group(1)`. The uniform buffer has a dynamic offset,
/// so that one buffer can hold the uniforms of many things.
pub fn user_layout(device: &wgpu::Device, shader: &Shader) -> wgpu::BindGroupLayout {
    let visibility = wgpu::ShaderStages::VERTEX_FRAGMENT;
    let mut entries = Vec::new();
    if let Some(b) = &shader.uniforms {
        entries.push(wgpu::BindGroupLayoutEntry {
            binding: b.binding,
            visibility,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: true,
                min_binding_size: wgpu::BufferSize::new(b.size as u64),
            },
            count: None,
        });
    }
    for t in &shader.textures {
        entries.push(wgpu::BindGroupLayoutEntry {
            binding: t.binding,
            visibility,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        });
    }
    for &binding in &shader.samplers {
        entries.push(wgpu::BindGroupLayoutEntry {
            binding,
            visibility,
            ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
            count: None,
        });
    }
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("framescript @group(1)"),
        entries: &entries,
    })
}

/// Binds `@group(1)` of `shader`: `uniforms` (whose offset is given when it is set), the textures in
/// the order the shader declares them, and `sampler` for every sampler.
pub fn user_bind_group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    shader: &Shader,
    uniforms: &wgpu::Buffer,
    textures: &[&wgpu::TextureView],
    sampler: &wgpu::Sampler,
) -> wgpu::BindGroup {
    let mut entries = Vec::new();
    if let Some(b) = &shader.uniforms {
        entries.push(wgpu::BindGroupEntry {
            binding: b.binding,
            resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                buffer: uniforms,
                offset: 0,
                size: wgpu::BufferSize::new(b.size as u64),
            }),
        });
    }
    for (t, view) in shader.textures.iter().zip(textures) {
        entries.push(wgpu::BindGroupEntry {
            binding: t.binding,
            resource: wgpu::BindingResource::TextureView(view),
        });
    }
    for &binding in &shader.samplers {
        entries.push(wgpu::BindGroupEntry {
            binding,
            resource: wgpu::BindingResource::Sampler(sampler),
        });
    }
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("framescript @group(1)"),
        layout,
        entries: &entries,
    })
}

/// A buffer that grows to what is put in it.
pub struct Growing {
    buffer: wgpu::Buffer,
    usage: wgpu::BufferUsages,
    label: &'static str,
}

impl Growing {
    pub fn new(device: &wgpu::Device, label: &'static str, usage: wgpu::BufferUsages) -> Self {
        let usage = usage | wgpu::BufferUsages::COPY_DST;
        Self {
            buffer: make(device, label, usage, 256),
            usage,
            label,
        }
    }

    /// Writes `bytes`, making the buffer bigger first if it has to be; says whether it was made
    /// again (and what is bound to it has to be too).
    pub fn write(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, bytes: &[u8]) -> bool {
        let mut made = false;
        if bytes.len() as u64 > self.buffer.size() {
            let size = (bytes.len() as u64).next_power_of_two();
            self.buffer = make(device, self.label, self.usage, size);
            made = true;
        }
        if !bytes.is_empty() {
            queue.write_buffer(&self.buffer, 0, bytes);
        }
        made
    }

    pub fn buffer(&self) -> &wgpu::Buffer {
        &self.buffer
    }
}

fn make(device: &wgpu::Device, label: &str, usage: wgpu::BufferUsages, size: u64) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some(label),
        size,
        usage,
        mapped_at_creation: false,
    })
}
