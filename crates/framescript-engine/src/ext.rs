//! The ops the TypeScript side reaches the node tree through.
//!
//! What runs every frame is a fast call with a `Uint32Array` borrowed from V8 ([`op_fs_commit`]),
//! text included (see [`crate::commands`]): nothing goes through JSON or serde. Only the property
//! table, asked for once at startup, and what a video or a sound is, asked for once per file, are
//! serialized.

use crate::commands::Nodes;
use crate::media::MediaNodes;
use crate::props::{Kind, PROPS};
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
    pub fault: Option<String>,
}

pub type SharedBridge = Rc<RefCell<Bridge>>;

#[op2(fast)]
fn op_fs_create(state: &mut OpState, kind: u32) -> u32 {
    state.borrow::<SharedBridge>().borrow_mut().nodes.create(kind)
}

#[op2(fast)]
fn op_fs_commit(state: &mut OpState, #[buffer] words: &[u32]) {
    let bridge = state.borrow::<SharedBridge>();
    let mut bridge = bridge.borrow_mut();
    let Bridge { nodes, media, fault } = &mut *bridge;
    if let Err(e) = nodes.apply(words, media)
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
    ops = [op_fs_create, op_fs_commit, op_fs_props, op_fs_video_info, op_fs_audio_info],
    options = { bridge: SharedBridge },
    state = |state, options| {
        state.put::<SharedBridge>(options.bridge);
    },
);
