//! The ops the TypeScript side reaches the node tree through.
//!
//! What runs every frame is a fast call with a `Uint32Array` borrowed from V8 ([`op_fs_commit`]),
//! text included (see [`crate::commands`]): nothing goes through JSON or serde. Only the property
//! table, asked for once at startup, and what a video or a sound is, asked for once per file, are
//! serialized. How loud a sound is over time comes as an `ArrayBuffer`, of `f32`s.

use crate::commands::{Drawn, Nodes};
use crate::media::MediaNodes;
use crate::props::{Kind, PROPS};
use crate::shader::{Shader, Stage};
use deno_core::{OpState, extension, op2};
use deno_error::JsErrorBox;
use serde::Serialize;
use std::cell::RefCell;
use std::rc::Rc;

/// What the ops share with the composition: the node handles, the pictures and videos they show,
/// and the first fault of the command buffer, which the composition reports after the call that
/// caused it.
pub struct Bridge {
    pub nodes: Nodes,
    pub media: MediaNodes,
    pub drawn: Drawn,
    pub fault: Option<String>,
}

pub type SharedBridge = Rc<RefCell<Bridge>>;

#[op2(fast)]
fn op_fs_create(state: &mut OpState, kind: u32) -> u32 {
    let bridge = state.borrow::<SharedBridge>();
    let mut bridge = bridge.borrow_mut();
    let Bridge { nodes, drawn, .. } = &mut *bridge;
    nodes.create(kind, drawn)
}

#[op2(fast)]
fn op_fs_commit(state: &mut OpState, #[buffer] words: &[u32]) {
    let bridge = state.borrow::<SharedBridge>();
    let mut bridge = bridge.borrow_mut();
    let Bridge {
        nodes,
        media,
        drawn,
        fault,
    } = &mut *bridge;
    if let Err(e) = nodes.apply(words, media, drawn)
        && fault.is_none()
    {
        *fault = Some(e);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoInfo {
    /// In seconds, or `null` if the file doesn't say.
    duration: Option<f64>,
    width: u32,
    height: u32,
    frame_rate: Option<f64>,
    has_audio: bool,
}

/// What the video in `src` is. Opening it starts decoding it, for when it shows.
#[op2]
#[serde]
fn op_fs_video_info(state: &mut OpState, #[string] src: String) -> Result<VideoInfo, JsErrorBox> {
    let bridge = state.borrow::<SharedBridge>().borrow();
    let source = bridge
        .media
        .video(&src)
        .map_err(|e| JsErrorBox::generic(format!("can't open the video {src}: {e}")))?;
    let info = source.info();
    Ok(VideoInfo {
        duration: info.duration,
        width: info.size.0,
        height: info.size.1,
        frame_rate: info.frame_rate,
        has_audio: info.has_audio,
    })
}

#[derive(Serialize)]
struct AudioInfo {
    /// In seconds, or `null` if the file doesn't say.
    duration: Option<f64>,
}

/// What the sound in `src` is. Throws if it has none.
#[op2]
#[serde]
fn op_fs_audio_info(state: &mut OpState, #[string] src: String) -> Result<AudioInfo, JsErrorBox> {
    let bridge = state.borrow::<SharedBridge>().borrow();
    let source = bridge
        .media
        .audio(&src)
        .map_err(|e| JsErrorBox::generic(format!("can't open the sound of {src}: {e}")))?;
    Ok(AudioInfo {
        duration: source.info().duration,
    })
}

/// How loud the sound of `src` is over time, as the bytes of `f32`s (see
/// [`crate::sound::AudioSource::levels`]). Throws if it has none.
#[op2]
#[arraybuffer]
fn op_fs_audio_levels(state: &mut OpState, #[string] src: String) -> Result<Vec<u8>, JsErrorBox> {
    let source = state
        .borrow::<SharedBridge>()
        .borrow()
        .media
        .audio(&src)
        .map_err(|e| JsErrorBox::generic(format!("can't open the sound of {src}: {e}")))?;
    let levels = source
        .levels()
        .map_err(|e| JsErrorBox::generic(format!("can't read the sound of {src}: {e}")))?;
    Ok(levels.iter().flat_map(|l| l.to_ne_bytes()).collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShaderInfo {
    /// The number the commands give it by.
    id: u32,
    /// Per uniform, in the order of their numbers: the name, the type, and how many numbers it
    /// takes.
    uniforms: Vec<(String, String, usize)>,
    textures: Vec<String>,
    uses_time: bool,
}

/// Compiles WGSL from `path` for `stage` (0 for a `<Shader>` box, 1 for a material), and says what
/// it takes. Throws what is wrong with it. The same code is compiled once.
#[op2]
#[serde]
fn op_fs_shader(
    state: &mut OpState,
    #[string] code: String,
    #[string] path: String,
    stage: u32,
) -> Result<ShaderInfo, JsErrorBox> {
    let stage = Stage::from_code(stage).ok_or_else(|| JsErrorBox::generic(format!("no stage {stage}")))?;
    let bridge = state.borrow::<SharedBridge>();
    let mut bridge = bridge.borrow_mut();
    let shaders = &mut bridge.drawn.shaders;
    let id = match shaders
        .iter()
        .position(|s| s.stage == stage && s.code.starts_with(&code) && s.code[code.len()..].starts_with('\n'))
    {
        Some(id) => id,
        None => {
            let shader = Shader::compile(&code, &path, stage).map_err(JsErrorBox::generic)?;
            shaders.push(std::sync::Arc::new(shader));
            shaders.len() - 1
        }
    };
    let s = &shaders[id];
    Ok(ShaderInfo {
        id: id as u32,
        uniforms: s
            .uniforms
            .iter()
            .flat_map(|b| &b.members)
            .map(|m| (m.name.clone(), m.ty.clone(), m.slots.len()))
            .collect(),
        textures: s.textures.iter().map(|t| t.name.clone()).collect(),
        uses_time: s.uses_time,
    })
}

#[derive(Serialize)]
struct ModelInfo {
    /// Per animation: its name and how long it is, in seconds.
    animations: Vec<(String, f32)>,
}

/// What the glTF model in `src` has. Reading it keeps it for when it is shown.
#[op2]
#[serde]
fn op_fs_model_info(state: &mut OpState, #[string] src: String) -> Result<ModelInfo, JsErrorBox> {
    let bridge = state.borrow::<SharedBridge>();
    let mut bridge = bridge.borrow_mut();
    let path = bridge.media.resolve(&src);
    let model = bridge.drawn.model(path).map_err(JsErrorBox::generic)?;
    Ok(ModelInfo {
        animations: model.animations.iter().map(|a| (a.name.clone(), a.duration)).collect(),
    })
}

/// The property table: per property its name, kind and, for choices, the names of the choices.
#[op2]
#[serde]
fn op_fs_props() -> Vec<(&'static str, u32, Vec<&'static str>)> {
    PROPS
        .iter()
        .map(|p| {
            let choices = match p.kind {
                Kind::Enum(names) => names.to_vec(),
                _ => Vec::new(),
            };
            (p.name, p.kind.code(), choices)
        })
        .collect()
}

extension!(
    framescript,
    ops = [
        op_fs_create,
        op_fs_commit,
        op_fs_props,
        op_fs_video_info,
        op_fs_audio_info,
        op_fs_audio_levels,
        op_fs_shader,
        op_fs_model_info,
    ],
    options = { bridge: SharedBridge },
    state = |state, options| {
        state.put::<SharedBridge>(options.bridge);
    },
);
