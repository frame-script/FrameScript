//! What the TypeScript side asks of the node tree, and the handles it knows the nodes by.
//!
//! Styles and the tree are changed through a buffer of `u32` words that the TypeScript side fills
//! while its effects run and hands over in one call (`op_fs_commit`): it never has to cross into
//! Rust for each property, and Rust never sees half of a frame's changes. Numbers travel as the
//! bits of an `f32` (the TypeScript side writes them through a `Float32Array` over the same
//! memory). Each command is its opcode followed by its operands:
//!
//! | opcode | operands |
//! |---|---|
//! | [`op::NUMBER`] | node, prop, f32 |
//! | [`op::LENGTH`] | node, prop, unit, f32 |
//! | [`op::COLOR`] | node, prop, rgba |
//! | [`op::ENUM`] | node, prop, index |
//! | [`op::UNSET`] | node, prop |
//! | [`op::SHADOWS`] | node, prop, count, then per shadow: x, y, blur, spread (f32), rgba, inset |
//! | [`op::CHILDREN`] | node, count, then the children |
//! | [`op::REMOVE`] | node |
//! | [`op::STRING`] | node, prop, length, then the UTF-16 code units, two to a word |
//! | [`op::TEXT`] | node, length, then the UTF-16 code units, two to a word |
//! | [`op::SOURCE`] | node, length, then the UTF-16 code units: the file an `img` or a video shows |
//! | [`op::VIDEO_TIME`] | node, shown (0 or 1), then the `f64` of the seconds as two words, low first |
//! | [`op::PARAM`] | node, param, count, then that many f32: a parameter of a `<Shader>`, a scene or a thing in 3D (see [`crate::space::param`]) |
//! | [`op::PARAM_TEXT`] | node, param, index, length, then the UTF-16 code units: a picture of one (see [`crate::space::text_param`]) |
//!
//! Handles are of nodes of the document or of things in 3D ([`crate::space`]), which are not in the
//! document: the children of a thing are things, and those of a scene can be both (the things are
//! in the scene, the nodes over it).
//!
//! Strings go in the buffer too, rather than through an op of their own, so that everything is done
//! in the order the TypeScript side asked for it.

use crate::flat::{FlatBox, FlatProps};
use crate::media::MediaNodes;
use crate::props::{self, Value};
use crate::shader::{Picture, Shader};
use crate::space::{self, Spaces, param, text_param};
use anti_webui_core::canvas::CanvasData;
use anti_webui_core::style::{BoxShadow, Color};
use anti_webui_core::text::TextLayout;
use anti_webui_core::tree::{Document, ImageData, Node, NodeId, NodeKind, TextData, with_doc};
use anti_webui_core::video::VideoData;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

pub mod op {
    pub const NUMBER: u32 = 1;
    pub const LENGTH: u32 = 2;
    pub const COLOR: u32 = 3;
    pub const ENUM: u32 = 4;
    pub const UNSET: u32 = 5;
    pub const SHADOWS: u32 = 6;
    pub const CHILDREN: u32 = 7;
    pub const REMOVE: u32 = 8;
    pub const STRING: u32 = 9;
    pub const TEXT: u32 = 10;
    pub const SOURCE: u32 = 11;
    pub const VIDEO_TIME: u32 = 12;
    pub const PARAM: u32 = 13;
    pub const PARAM_TEXT: u32 = 14;
}

/// What a node is made as (`op_fs_create`).
pub mod kind {
    pub const ELEMENT: u32 = 0;
    pub const TEXT: u32 = 1;
    pub const IMAGE: u32 = 2;
    pub const VIDEO: u32 = 3;
    /// A box a shader draws: `<Shader>`.
    pub const SHADER: u32 = 4;
    /// A box with a scene in 3D: `<Scene3D>`.
    pub const SCENE: u32 = 5;
    pub const GROUP: u32 = 6;
    pub const MESH: u32 = 7;
    pub const CAMERA: u32 = 8;
    pub const LIGHT: u32 = 9;
}

/// What a handle is of.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Entry {
    Node(NodeId),
    Thing(u32),
}

/// What the composition draws on the GPU itself: the shaders the scripts compiled, the pictures
/// given to them, `<Shader>` boxes and scenes in 3D.
#[derive(Default)]
pub struct Drawn {
    /// By the number the scripts know them by.
    pub shaders: Vec<Arc<Shader>>,
    pictures: HashMap<PathBuf, Arc<Picture>>,
    /// By handle.
    flats: HashMap<u32, (NodeId, FlatBox)>,
    spaces: Spaces,
}

impl Drawn {
    /// Hands what changed to the boxes that show it. Run after a frame's commands, before the
    /// document is painted.
    pub fn sync(&mut self, doc: &mut Document) {
        for (node, flat) in self.flats.values_mut() {
            if !std::mem::take(&mut flat.changed) {
                continue;
            }
            let Some(frame) = flat.frame() else {
                continue;
            };
            if let Some(NodeKind::Canvas(c)) = doc.get_mut(*node).map(|n| &mut n.kind) {
                c.set_paint(anti_webui_wgpu::canvas::portable::<crate::flat::FlatPaint>(FlatProps(
                    Arc::new(frame),
                )));
                doc.mark_shader_of(*node);
            }
        }
        self.spaces.sync(doc);
    }

    fn picture(&mut self, path: PathBuf) -> Result<Arc<Picture>, String> {
        if let Some(p) = self.pictures.get(&path) {
            return Ok(p.clone());
        }
        let p = Picture::load(&path)?;
        self.pictures.insert(path, p.clone());
        Ok(p)
    }
}

/// The nodes the TypeScript side holds, by handle. Handle 0 is the stage, which the composition
/// makes; the others are made with [`Nodes::create`].
#[derive(Default)]
pub struct Nodes {
    ids: Vec<Option<Entry>>,
    free: Vec<u32>,
}

impl Nodes {
    pub fn new(stage: NodeId) -> Self {
        Self {
            ids: vec![Some(Entry::Node(stage))],
            free: Vec::new(),
        }
    }

    /// The node of the document `handle` is, if it is one.
    pub fn get(&self, handle: u32) -> Option<NodeId> {
        match self.ids.get(handle as usize).copied().flatten() {
            Some(Entry::Node(id)) => Some(id),
            _ => None,
        }
    }

    fn entry(&self, handle: u32) -> Option<Entry> {
        self.ids.get(handle as usize).copied().flatten()
    }

    fn take_handle(&mut self, entry: Entry) -> u32 {
        match self.free.pop() {
            Some(handle) => {
                self.ids[handle as usize] = Some(entry);
                handle
            }
            None => {
                self.ids.push(Some(entry));
                (self.ids.len() - 1) as u32
            }
        }
    }

    pub fn create(&mut self, kind: u32, drawn: &mut Drawn) -> u32 {
        let thing = match kind {
            kind::GROUP => Some(space::Kind::Group),
            kind::MESH => Some(space::Kind::Mesh),
            kind::CAMERA => Some(space::Kind::Camera),
            kind::LIGHT => Some(space::Kind::Light),
            _ => None,
        };
        if let Some(thing) = thing {
            let id = drawn.spaces.create(thing);
            return self.take_handle(Entry::Thing(id));
        }
        let node = match kind {
            kind::TEXT => Node::new(NodeKind::Text(TextData {
                text: String::new(),
                version: 0,
                layout: TextLayout::default(),
                zoom: 1.0,
                in_svg: false,
                rich: None,
                row: None,
            })),
            kind::IMAGE => Node::new(NodeKind::Image(Box::new(ImageData {
                density: 1.0,
                ..Default::default()
            }))),
            kind::VIDEO => Node::new(NodeKind::Video(Box::<VideoData>::default())),
            kind::SHADER | kind::SCENE => Node::new(NodeKind::Canvas(Box::new(CanvasData::portable(
                anti_webui_wgpu::canvas::next_canvas_id(),
                // Given what it shows once the commands of the frame are in.
                Arc::new(()),
            )))),
            _ => Node::new(NodeKind::Element),
        };
        let id = with_doc(|d| d.create(node));
        let handle = self.take_handle(Entry::Node(id));
        match kind {
            kind::SHADER => {
                drawn.flats.insert(handle, (id, FlatBox::default()));
            }
            kind::SCENE => drawn.spaces.add_world(handle, id),
            _ => {}
        }
        handle
    }

    fn remove(&mut self, doc: &mut Document, media: &mut MediaNodes, drawn: &mut Drawn, handle: u32) {
        // The stage belongs to the composition.
        if handle == 0 {
            return;
        }
        match self.ids.get_mut(handle as usize).and_then(Option::take) {
            Some(Entry::Node(id)) => {
                doc.remove(id);
                media.forget(handle);
                drawn.flats.remove(&handle);
                drawn.spaces.remove_world(handle);
            }
            Some(Entry::Thing(id)) => drawn.spaces.remove(id),
            None => return,
        }
        self.free.push(handle);
    }

    /// Carries out the commands in `words`. A malformed buffer is a bug of the TypeScript side: what
    /// comes before the fault is kept, the rest is dropped, and the fault is returned.
    pub fn apply(&mut self, words: &[u32], media: &mut MediaNodes, drawn: &mut Drawn) -> Result<(), String> {
        with_doc(|d| {
            let mut r = Reader { words, at: 0 };
            while !r.done() {
                let code = r.next()?;
                match code {
                    op::NUMBER | op::LENGTH | op::COLOR | op::ENUM | op::UNSET | op::SHADOWS => {
                        let node = r.next()?;
                        let prop = r.next()?;
                        let value = match code {
                            op::NUMBER => Value::Number(r.number()?),
                            op::LENGTH => Value::Length(r.next()?, r.number()?),
                            op::COLOR => Value::Color(r.next()?),
                            op::ENUM => Value::Enum(r.next()?),
                            op::SHADOWS => {
                                let count = r.next()?;
                                let mut list = Vec::with_capacity(count as usize);
                                for _ in 0..count {
                                    list.push(BoxShadow {
                                        offset_x: r.number()?,
                                        offset_y: r.number()?,
                                        blur: r.number()?,
                                        spread: r.number()?,
                                        color: Color::from_rgba(r.next()?),
                                        inset: r.next()? != 0,
                                    });
                                }
                                Value::Shadows(list)
                            }
                            _ => Value::Unset,
                        };
                        let p = props::get(prop).ok_or(format!("no property {prop}"))?;
                        if let Some(id) = self.get(node) {
                            set_prop(d, id, p, &value);
                        }
                    }
                    op::CHILDREN => {
                        let node = r.next()?;
                        let count = r.next()? as usize;
                        let mut children = Vec::with_capacity(count);
                        let mut things = Vec::new();
                        for _ in 0..count {
                            match self.entry(r.next()?) {
                                Some(Entry::Node(id)) => children.push(id),
                                Some(Entry::Thing(id)) => things.push(id),
                                None => {}
                            }
                        }
                        match self.entry(node) {
                            Some(Entry::Node(id)) => {
                                if !things.is_empty() && !drawn.spaces.is_world(node) {
                                    return Err("things in 3D can only be in a <Scene3D>".into());
                                }
                                d.set_children(id, children);
                                if drawn.spaces.is_world(node) {
                                    drawn.spaces.set_roots(node, things);
                                }
                            }
                            Some(Entry::Thing(id)) => {
                                if !children.is_empty() {
                                    return Err(
                                        "a thing in 3D can only hold other things in 3D: put the \
                                         rest over the <Scene3D>"
                                            .into(),
                                    );
                                }
                                drawn.spaces.set_children(id, things);
                            }
                            None => {}
                        }
                    }
                    op::REMOVE => {
                        let node = r.next()?;
                        self.remove(d, media, drawn, node);
                    }
                    op::PARAM => {
                        let node = r.next()?;
                        let param = r.next()?;
                        let count = r.next()? as usize;
                        let values: Vec<f32> = (0..count).map(|_| r.number()).collect::<Result<_, _>>()?;
                        self.set_param(drawn, node, param, &values)?;
                    }
                    op::PARAM_TEXT => {
                        let node = r.next()?;
                        let param = r.next()?;
                        let index = r.next()?;
                        let src = r.string()?;
                        let picture = match src.is_empty() {
                            true => None,
                            false => Some(drawn.picture(media.resolve(&src))?),
                        };
                        match self.entry(node) {
                            Some(Entry::Thing(id)) => drawn.spaces.set_picture(id, param, index, picture),
                            Some(Entry::Node(_)) => {
                                if let Some((_, flat)) = drawn.flats.get_mut(&node)
                                    && let Some(slot) = flat.textures.get_mut(index as usize)
                                    && param == text_param::TEXTURE
                                {
                                    *slot = picture;
                                    flat.changed = true;
                                }
                            }
                            None => {}
                        }
                    }
                    op::SOURCE => {
                        let node = r.next()?;
                        let src = r.string()?;
                        if let Some(id) = self.get(node) {
                            media.set_source(d, node, id, &src);
                        }
                    }
                    op::VIDEO_TIME => {
                        let node = r.next()?;
                        let shown = r.next()? != 0;
                        let low = r.next()? as u64;
                        let high = r.next()? as u64;
                        media.set_time(node, f64::from_bits(low | high << 32), shown);
                    }
                    op::STRING => {
                        let node = r.next()?;
                        let prop = r.next()?;
                        let text = r.string()?;
                        let p = props::get(prop).ok_or(format!("no property {prop}"))?;
                        if let Some(id) = self.get(node) {
                            set_prop(d, id, p, &Value::String(&text));
                        }
                    }
                    op::TEXT => {
                        let node = r.next()?;
                        let text = r.string()?;
                        if let Some(id) = self.get(node) {
                            set_text(d, id, text);
                        }
                    }
                    other => return Err(format!("unknown command {other}")),
                }
            }
            Ok(())
        })
    }
}

impl Nodes {
    fn set_param(&mut self, drawn: &mut Drawn, node: u32, param: u32, values: &[f32]) -> Result<(), String> {
        match self.entry(node) {
            Some(Entry::Thing(id)) => drawn.spaces.set(id, param, values, &drawn.shaders),
            Some(Entry::Node(_)) => {
                if drawn.spaces.set_world(node, param, values) {
                    return Ok(());
                }
                let Some((_, flat)) = drawn.flats.get_mut(&node) else {
                    return Ok(());
                };
                match param {
                    param::SHADER => {
                        if let Some(s) = values.first().and_then(|&i| drawn.shaders.get(i as usize)) {
                            flat.set_shader(s.clone());
                        }
                    }
                    param::UNIFORM => {
                        if let (Some(shader), Some((&member, v))) = (&flat.shader, values.split_first()) {
                            shader.write_uniform(&mut flat.uniforms, member as usize, v)?;
                            flat.changed = true;
                        }
                    }
                    param::TIME => {
                        flat.time = [
                            values.first().copied().unwrap_or(0.0),
                            values.get(1).copied().unwrap_or(0.0),
                        ];
                        flat.changed = true;
                    }
                    other => return Err(format!("no parameter {other} of a <Shader>")),
                }
                Ok(())
            }
            None => Ok(()),
        }
    }
}

fn set_text(d: &mut Document, id: NodeId, text: String) {
    if let Some(n) = d.get_mut(id)
        && let NodeKind::Text(t) = &mut n.kind
        && t.text != text
    {
        t.text = text;
        t.version += 1;
        d.invalidate_layout(id);
    }
}

fn set_prop(d: &mut Document, id: NodeId, prop: &props::Prop, value: &Value) {
    let Some(n) = d.get_mut(id) else {
        return;
    };
    // The TypeScript side only sends what changed, and resolving finds out if nothing did.
    (prop.apply)(&mut n.style.base, value);
    d.mark_style_of(id);
}

struct Reader<'a> {
    words: &'a [u32],
    at: usize,
}

impl Reader<'_> {
    fn done(&self) -> bool {
        self.at >= self.words.len()
    }

    fn next(&mut self) -> Result<u32, String> {
        let w = *self
            .words
            .get(self.at)
            .ok_or_else(|| format!("the command buffer ends in a command ({} words)", self.words.len()))?;
        self.at += 1;
        Ok(w)
    }

    fn number(&mut self) -> Result<f32, String> {
        self.next().map(f32::from_bits)
    }

    /// A length in UTF-16 code units, then the units, two to a word (the first in the low half).
    fn string(&mut self) -> Result<String, String> {
        let len = self.next()? as usize;
        let words = len.div_ceil(2);
        let end = self.at + words;
        let packed = self
            .words
            .get(self.at..end)
            .ok_or("the command buffer ends in a string")?;
        self.at = end;
        let units = packed
            .iter()
            .flat_map(|w| [*w as u16, (*w >> 16) as u16])
            .take(len);
        Ok(char::decode_utf16(units)
            .map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER))
            .collect())
    }
}
