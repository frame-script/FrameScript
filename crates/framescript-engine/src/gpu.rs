//! What the GPU painters of a composition (`<Shader>` and `<Scene3D>`) share: textures of pictures,
//! and what a shader's `@group(1)` is bound to.
//!
//! The painters go with the scene (AntiWebUI's portable canvases): whatever draws the scene, the
//! preview on the UI thread or a worker of an export, makes them on its own device. Everything here
//! is made again on each.

use crate::shader::{Picture, Shader, Texture};
use anti_webui_core::geometry::{Affine, PointI, RectI};
use anti_webui_core::scene::{Clip, Layer, Primitive, Scene, VideoDraw};
use anti_webui_core::style::Color;
use anti_webui_core::video::VideoFrame;
use anti_webui_wgpu::wgpu;
use std::collections::HashMap;
use std::sync::{Arc, Weak};

/// The textures a painter has drawn with: of pictures, kept while the pictures are there, and of
/// videos, one per stream, drawn again when its frame changes.
pub struct Pictures {
    of: HashMap<u64, (Weak<Picture>, wgpu::TextureView)>,
    videos: HashMap<u64, Frame>,
    /// Of nodes of the document, by their keys.
    painted: HashMap<u32, Frame>,
    /// What draws the frames of videos (as AntiWebUI draws them in a window: every way they are
    /// stored, turned as they say), made when the first one comes.
    renderer: Option<anti_webui_wgpu::Renderer>,
    /// What shows where there is no picture: white, so that it changes nothing it multiplies.
    white: wgpu::TextureView,
}

/// The texture of the frame of a video, or of how a node looks.
struct Frame {
    /// What it is of, which is there for as long as it is to be kept.
    alive: Alive,
    /// The frame it holds, or the scene it was drawn from.
    id: u64,
    size: (u32, u32),
    /// What it is drawn into.
    target: wgpu::TextureView,
    /// The same, read as light.
    view: wgpu::TextureView,
}

impl Pictures {
    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue) -> Self {
        let white = upload(device, queue, 1, 1, &[255; 4]);
        Self {
            of: HashMap::new(),
            videos: HashMap::new(),
            painted: HashMap::new(),
            renderer: None,
            white,
        }
    }

    /// The texture of `texture`, made (or, for a video, drawn) the first time. It is read as light.
    pub fn view(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        texture: Option<&Texture>,
    ) -> &wgpu::TextureView {
        match texture {
            None => &self.white,
            Some(Texture::Picture(p)) => {
                &self
                    .of
                    .entry(p.id)
                    .or_insert_with(|| {
                        let view = upload(device, queue, p.width, p.height, &p.pixels);
                        (Arc::downgrade(p), view)
                    })
                    .1
            }
            Some(Texture::Video(frame)) => self.video(device, queue, encoder, frame),
            Some(Texture::Painted(p)) => {
                let size = (p.rect.width.max(1) as u32, p.rect.height.max(1) as u32);
                let id = Arc::as_ptr(&p.scene) as u64;
                let alive = Alive::Scene(Arc::downgrade(&p.scene));
                // What is in the node, moved so that the node's box is all of the texture.
                let scene = || Scene {
                    width: size.0,
                    height: size.1,
                    clear: Color::from_rgba(0),
                    primitives: vec![Primitive::Layer(Layer {
                        key: u64::from(p.key) | 1 << 40,
                        clip: Clip::NONE,
                        origin: PointI {
                            x: -p.rect.x,
                            y: -p.rect.y,
                        },
                        transform: Affine::IDENTITY,
                        bounds: RectI::INFINITE,
                        opacity: 1.0,
                        content: p.scene.clone(),
                        filter: None,
                    })],
                    chunks: Vec::new(),
                };
                let (renderer, kept) = (&mut self.renderer, &mut self.painted);
                draw(device, queue, encoder, renderer, kept, p.key, size, id, alive, scene)
            }
        }
    }

    fn video(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        frame: &Arc<VideoFrame>,
    ) -> &wgpu::TextureView {
        // As it shows, turned.
        let (w, h) = match frame.rotation % 180 {
            90 => (frame.size.1, frame.size.0),
            _ => frame.size,
        };
        let size = (w.max(1), h.max(1));
        let all = RectI::new(0, 0, size.0 as i32, size.1 as i32);
        let scene = || Scene {
            width: size.0,
            height: size.1,
            clear: Color::from_rgba(0),
            primitives: vec![Primitive::Video(VideoDraw {
                frame: frame.clone(),
                rect: all,
                shape: Clip {
                    rect: all,
                    radii: [0.0; 4],
                },
                clip: Clip::NONE,
                opacity: 1.0,
            })],
            chunks: Vec::new(),
        };
        let alive = Alive::Stream(frame.alive.clone());
        let (renderer, kept) = (&mut self.renderer, &mut self.videos);
        draw(device, queue, encoder, renderer, kept, frame.stream, size, frame.id, alive, scene)
    }

    /// Whether the texture of the picture `id` is kept.
    pub fn has(&self, id: u64) -> bool {
        self.of.contains_key(&id)
    }

    /// Lets go of the textures of pictures, videos and nodes nobody has any more.
    pub fn retain(&mut self) {
        self.of.retain(|_, (p, _)| p.strong_count() > 0);
        self.videos.retain(|_, v| v.alive.is_alive());
        self.painted.retain(|_, v| v.alive.is_alive());
    }
}

enum Alive {
    Stream(std::sync::Weak<()>),
    Scene(Weak<Scene>),
}

impl Alive {
    fn is_alive(&self) -> bool {
        match self {
            Alive::Stream(w) => w.strong_count() > 0,
            Alive::Scene(w) => w.strong_count() > 0,
        }
    }
}

/// The texture kept as `key` in `kept`, of `size`, holding what `scene` draws: drawn again (by
/// AntiWebUI's renderer, which is made the first time) when `id` isn't what it holds.
#[allow(clippy::too_many_arguments)]
fn draw<'k, K: std::hash::Hash + Eq + Copy>(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    encoder: &mut wgpu::CommandEncoder,
    renderer: &mut Option<anti_webui_wgpu::Renderer>,
    kept: &'k mut HashMap<K, Frame>,
    key: K,
    size: (u32, u32),
    id: u64,
    alive: Alive,
    scene: impl FnOnce() -> Scene,
) -> &'k wgpu::TextureView {
    if kept.get(&key).is_none_or(|k| k.size != size) {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("framescript drawn texture"),
            size: wgpu::Extent3d {
                width: size.0,
                height: size.1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[wgpu::TextureFormat::Rgba8UnormSrgb],
        });
        let target = texture.create_view(&Default::default());
        let view = texture.create_view(&wgpu::TextureViewDescriptor {
            format: Some(wgpu::TextureFormat::Rgba8UnormSrgb),
            ..Default::default()
        });
        kept.insert(
            key,
            Frame {
                alive,
                id: u64::MAX,
                size,
                target,
                view,
            },
        );
    }
    let k = kept.get_mut(&key).expect("just made");
    if k.id != id {
        k.id = id;
        let renderer = renderer.get_or_insert_with(|| anti_webui_wgpu::Renderer::new(device, wgpu::TextureFormat::Rgba8Unorm));
        renderer.render(device, queue, encoder, &k.target, &scene());
    }
    &k.view
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
