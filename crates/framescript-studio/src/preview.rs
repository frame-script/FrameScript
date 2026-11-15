//! The preview: scenes from the worker, drawn in a `gpu_canvas`.
//!
//! The worker paints on its own thread; what reaches the UI thread is only the [`Scene`], which is
//! drawn here by a renderer of the preview's own with the window's GPU device, into a texture the
//! size of the scene (the project's, whatever the box: see [`Composition::size`]), and then drawn
//! from that in the middle of the box, as big as fits with the project's aspect, but no bigger
//! than it is (around it is clear).
//!
//! [`Composition::size`]: framescript_engine::Composition::size

use anti_webui::core::scene::Scene;
use anti_webui::gpu::{GpuFrame, GpuInit, GpuPaint, wgpu};
use anti_webui::wgpu::Renderer;
use framescript_engine::resample::Resampler;
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
    resampler: Resampler,
    format: wgpu::TextureFormat,
    /// The texture the scene is drawn in, for its size.
    target: Option<((u32, u32), wgpu::TextureView, wgpu::BindGroup)>,
}

impl GpuPaint for Preview {
    type Props = Option<PreviewFrame>;

    fn new(gpu: &GpuInit<'_>) -> Self {
        crate::system::note_display_gpu(gpu.device.adapter_info());
        Self {
            renderer: Renderer::new(gpu.device, gpu.format),
            resampler: Resampler::new(gpu.device, gpu.format),
            format: gpu.format,
            target: None,
        }
    }

    fn render(&mut self, props: &Self::Props, frame: &mut GpuFrame<'_>) {
        // Around the picture, what the box is on shows through.
        let clear = Some(wgpu::Color::TRANSPARENT);
        let Some(shown) = props else {
            frame.begin_pass(clear);
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
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                    | wgpu::TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            });
            let view = texture.create_view(&Default::default());
            let bind = self.resampler.bind(frame.device, &view);
            self.target = Some((size, view, bind));
        }
        let (_, view, bind) = self.target.as_ref().expect("made above");
        self.renderer
            .render(frame.device, frame.queue, frame.encoder, view, scene);

        // As big as fits in the box with the scene's aspect, in the middle; pixel for pixel when
        // the scene fits as it is.
        let (bw, bh) = (frame.size.0 as f32, frame.size.1 as f32);
        let (sw, sh) = (size.0 as f32, size.1 as f32);
        let fit = (bw / sw).min(bh / sh);
        let scale = if fit >= 1.0 { 1.0 } else { fit };
        let (w, h) = ((sw * scale).round(), (sh * scale).round());
        let (x, y) = (((bw - w) / 2.0).floor(), ((bh - h) / 2.0).floor());
        let mut pass = frame.begin_pass(clear);
        pass.set_viewport(x, y, w.max(1.0), h.max(1.0), 0.0, 1.0);
        self.resampler.draw(&mut pass, bind);
    }
}
