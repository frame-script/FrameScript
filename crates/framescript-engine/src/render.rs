//! Drawing scenes offscreen, without a window: for the command line and tests. Exporting videos
//! will go through here too.

use anti_webui_core::scene::Scene;
use anti_webui_wgpu::{Gpu, Renderer};
use std::path::Path;

pub struct OffscreenRenderer {
    gpu: Gpu,
    renderer: Renderer,
}

impl OffscreenRenderer {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let gpu = Gpu::headless()?;
        let renderer = Renderer::new(&gpu.device, anti_webui_wgpu::wgpu::TextureFormat::Rgba8Unorm);
        Ok(Self { gpu, renderer })
    }

    /// Tightly packed RGBA8 pixels of `scene`.
    pub fn rgba(&mut self, scene: &Scene) -> Vec<u8> {
        self.gpu.render_to_rgba(&mut self.renderer, scene)
    }
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
