//! FrameScript2's engine: compositions written in TSX, run in V8 (deno_core), laid out and
//! painted by AntiWebUI.
//!
//! - [`composition`]: a loaded project, which makes the [`Scene`](anti_webui_core::scene::Scene)
//!   of any frame.
//! - [`worker`]: a composition on a thread of its own, for the preview.
//! - [`media`]: pictures and videos, and the cache of decoded frames that makes seeking fast.
//! - [`sound`]: what sound plays when, mixed from the files it is in; [`playback`] plays it.
//! - [`render`]: drawing a scene offscreen, into pixels or a PNG file; [`resample`] draws it at
//!   another size.
//! - [`export`]: writing the whole of it out as a video file, drawing frames on several threads.
//! - [`ext`], [`commands`], [`props`]: how the TypeScript side reaches the node tree.
//! - [`shader`], [`flat`], [`space`]: WGSL that compositions write, `<Shader>` boxes, and scenes in
//!   3D, drawn on the GPU by whatever draws the scene ([`gpu`] has what they share).

pub mod commands;
pub mod composition;
pub mod export;
pub mod ext;
pub mod flat;
pub mod gpu;
pub mod loader;
pub mod media;
pub mod props;
pub mod playback;
pub mod render;
pub mod resample;
pub mod shader;
pub mod sound;
pub mod space;
pub mod worker;

pub use composition::{
    ClipInfo, Composition, Error, FrameTimings, ProjectInfo, ProjectSettings, Rendered, Wait,
};
pub use export::{Codec, Export, ExportSettings, Progress, Speed, Stage};
pub use media::Media;
pub use playback::AudioPlayer;
pub use sound::AudioPlan;

/// The version of V8 that runs the compositions.
pub fn v8_version() -> &'static str {
    deno_core::v8::V8::get_version()
}
