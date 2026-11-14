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
//!
//! Strings go in the buffer too, rather than through an op of their own, so that everything is done
//! in the order the TypeScript side asked for it.

use crate::media::MediaNodes;
use crate::props::{self, Value};
use anti_webui_core::style::{BoxShadow, Color};
use anti_webui_core::text::TextLayout;
use anti_webui_core::tree::{Document, ImageData, Node, NodeId, NodeKind, TextData, with_doc};
use anti_webui_core::video::VideoData;

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
}

/// What a node is made as (`op_fs_create`).
pub mod kind {
    pub const ELEMENT: u32 = 0;
    pub const TEXT: u32 = 1;
    pub const IMAGE: u32 = 2;
    pub const VIDEO: u32 = 3;
}

/// The nodes the TypeScript side holds, by handle. Handle 0 is the stage, which the composition
/// makes; the others are made with [`Nodes::create`].
#[derive(Default)]
pub struct Nodes {
    ids: Vec<Option<NodeId>>,
    free: Vec<u32>,
}

impl Nodes {
    pub fn new(stage: NodeId) -> Self {
        Self {
            ids: vec![Some(stage)],
            free: Vec::new(),
        }
    }

    pub fn get(&self, handle: u32) -> Option<NodeId> {
        self.ids.get(handle as usize).copied().flatten()
    }

    pub fn create(&mut self, kind: u32) -> u32 {
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
            _ => Node::new(NodeKind::Element),
        };
        let id = with_doc(|d| d.create(node));
        match self.free.pop() {
            Some(handle) => {
                self.ids[handle as usize] = Some(id);
                handle
            }
            None => {
                self.ids.push(Some(id));
                (self.ids.len() - 1) as u32
            }
        }
    }

    fn remove(&mut self, doc: &mut Document, media: &mut MediaNodes, handle: u32) {
        // The stage belongs to the composition.
        if handle == 0 {
            return;
        }
        if let Some(id) = self.ids.get_mut(handle as usize).and_then(Option::take) {
            doc.remove(id);
            media.forget(handle);
            self.free.push(handle);
        }
    }

    /// Carries out the commands in `words`. A malformed buffer is a bug of the TypeScript side: what
    /// comes before the fault is kept, the rest is dropped, and the fault is returned.
    pub fn apply(&mut self, words: &[u32], media: &mut MediaNodes) -> Result<(), String> {
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
                        for _ in 0..count {
                            if let Some(id) = self.get(r.next()?) {
                                children.push(id);
                            }
                        }
                        if let Some(id) = self.get(node) {
                            d.set_children(id, children);
                        }
                    }
                    op::REMOVE => {
                        let node = r.next()?;
                        self.remove(d, media, node);
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
