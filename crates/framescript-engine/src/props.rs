//! The style properties a composition can set, by number.
//!
//! This table is the one place that ties the names the TypeScript side writes (`opacity`,
//! `justifyContent`, ...) to the fields of AntiWebUI's [`Style`]. The TypeScript side asks for it
//! once at startup (`op_fs_props`) and from then on sends only the numbers, in the command buffer
//! (see [`crate::commands`]).

use anti_webui_style::{
    AlignContent, AlignItems, BoxShadow, Color, Display, FillRule, FlexDirection, FlexWrap,
    FontFamily, FontStyle, FontWeight, Gradient, GradientShape, GradientSpread, GradientStop,
    GradientUnits, ImageRendering, JustifyContent, Length, LineCap, LineHeight, LineJoin,
    ObjectFit, Overflow, PaintOrder, Position, Style, SvgPaint, TextAlign, TextShadow, TextStroke,
    WhiteSpace,
};

/// How the value of a property is encoded in the command buffer.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// One `f32`.
    Number,
    /// A unit and an `f32`; see [`Unit`].
    Length,
    /// `0xRRGGBBAA`.
    Color,
    /// The index of one of the names.
    Enum(&'static [&'static str]),
    /// 0 or 1, sent as a number.
    Bool,
    /// Any number of shadows.
    Shadows,
    /// A string, sent with its own op.
    String,
    /// Any number of `f32`s: dashes, or a paint (see [`paint`]).
    Numbers,
}

impl Kind {
    /// The number the TypeScript side knows the kind by.
    pub fn code(self) -> u32 {
        match self {
            Kind::Number => 0,
            Kind::Length => 1,
            Kind::Color => 2,
            Kind::Enum(_) => 3,
            Kind::Bool => 4,
            Kind::Shadows => 5,
            Kind::String => 6,
            Kind::Numbers => 7,
        }
    }
}

/// The unit of a [`Kind::Length`].
pub mod unit {
    pub const PX: u32 = 0;
    pub const PERCENT: u32 = 1;
    pub const AUTO: u32 = 2;
    /// A bare number: a multiple of the font size for `lineHeight`, pixels elsewhere.
    pub const NUMBER: u32 = 3;
}

/// A decoded value. `Unset` takes the property away again.
#[derive(Clone, Debug, PartialEq)]
pub enum Value<'a> {
    Unset,
    Number(f32),
    Length(u32, f32),
    Color(u32),
    Enum(u32),
    Shadows(Vec<BoxShadow>),
    String(&'a str),
    Numbers(Vec<f32>),
}

impl Value<'_> {
    fn number(&self) -> Option<f32> {
        match *self {
            Value::Number(v) => Some(v),
            Value::Length(_, v) => Some(v),
            _ => None,
        }
    }

    fn length(&self) -> Option<Length> {
        match *self {
            Value::Length(unit::PERCENT, v) => Some(Length::Percent(v)),
            Value::Length(unit::AUTO, _) => Some(Length::Auto),
            Value::Length(_, v) | Value::Number(v) => Some(Length::Px(v)),
            _ => None,
        }
    }

    fn color(&self) -> Option<Color> {
        match *self {
            Value::Color(c) => Some(Color::from_rgba(c)),
            _ => None,
        }
    }

    fn pick<T: Copy>(&self, options: &[T]) -> Option<T> {
        match *self {
            Value::Enum(i) => options.get(i as usize).copied(),
            _ => None,
        }
    }

    fn flag(&self) -> Option<bool> {
        self.number().map(|v| v != 0.0)
    }

    fn numbers(&self) -> Option<&[f32]> {
        match self {
            Value::Numbers(v) => Some(v),
            _ => None,
        }
    }
}

/// What a shape is painted with, from its numbers: `[0]` nothing, `[1, r, g, b, a]` a color (from
/// 0 to 1, not premultiplied), `[2]` the color of text, and gradients, `[3, spread, units, x1, y1,
/// x2, y2, …]` along a line and `[4, spread, units, cx, cy, r, fx, fy, …]` out from a point, then
/// the six numbers of their transform and, for each stop, its offset and color.
pub fn paint(v: &[f32]) -> Option<SvgPaint> {
    let color = |c: &[f32]| Color::new(c[0], c[1], c[2], c[3]);
    match *v.first()? as u32 {
        0 => Some(SvgPaint::None),
        1 if v.len() == 5 => Some(SvgPaint::Color(color(&v[1..]))),
        2 => Some(SvgPaint::CurrentColor),
        kind @ (3 | 4) => {
            let (spread, units) = (*v.get(1)?, *v.get(2)?);
            let (shape, rest) = match kind {
                3 => {
                    let [x1, y1, x2, y2] = *v.get(3..7)? else { return None };
                    (GradientShape::Linear { x1, y1, x2, y2 }, v.get(7..)?)
                }
                _ => {
                    let [cx, cy, r, fx, fy] = *v.get(3..8)? else { return None };
                    (GradientShape::Radial { cx, cy, r, fx, fy }, v.get(8..)?)
                }
            };
            let (transform, stops) = (rest.get(..6)?, rest.get(6..)?);
            if stops.len() % 5 != 0 {
                return None;
            }
            Some(SvgPaint::from(Gradient {
                shape,
                stops: stops
                    .chunks_exact(5)
                    .map(|s| GradientStop { offset: s[0], color: color(&s[1..]) })
                    .collect(),
                spread: match spread as u32 {
                    1 => GradientSpread::Reflect,
                    2 => GradientSpread::Repeat,
                    _ => GradientSpread::Pad,
                },
                units: match units as u32 {
                    1 => GradientUnits::UserSpace,
                    _ => GradientUnits::ObjectBoundingBox,
                },
                transform: std::array::from_fn(|i| transform[i] as f64),
            }))
        }
        _ => None,
    }
}

pub struct Prop {
    pub name: &'static str,
    pub kind: Kind,
    /// Writes the value into the style; `Unset` (or a value of the wrong kind) clears it.
    pub apply: fn(&mut Style, &Value),
}

macro_rules! number {
    ($name:literal, $($field:ident),+) => {
        Prop { name: $name, kind: Kind::Number, apply: |s, v| { $( s.$field = v.number(); )+ } }
    };
}

macro_rules! length {
    ($name:literal, $($field:ident),+) => {
        Prop { name: $name, kind: Kind::Length, apply: |s, v| { $( s.$field = v.length(); )+ } }
    };
}

macro_rules! color {
    ($name:literal, $field:ident) => {
        Prop { name: $name, kind: Kind::Color, apply: |s, v| s.$field = v.color() }
    };
}

macro_rules! choice {
    ($name:literal, $field:ident, [$($label:literal => $value:expr),+ $(,)?]) => {
        Prop {
            name: $name,
            kind: Kind::Enum(&[$($label),+]),
            apply: |s, v| s.$field = v.pick(&[$($value),+]),
        }
    };
}

macro_rules! flag {
    ($name:literal, $field:ident) => {
        Prop { name: $name, kind: Kind::Bool, apply: |s, v| s.$field = v.flag() }
    };
}

const ALIGN: [(&str, AlignItems); 4] = [
    ("start", AlignItems::Start),
    ("end", AlignItems::End),
    ("center", AlignItems::Center),
    ("stretch", AlignItems::Stretch),
];

/// Every property, in the order of their numbers.
pub static PROPS: &[Prop] = &[
    choice!("display", display, [
        "block" => Display::Block,
        "flex" => Display::Flex,
        "none" => Display::None,
        "contents" => Display::Contents,
    ]),
    choice!("position", position, [
        "static" => Position::Static,
        "relative" => Position::Relative,
        "absolute" => Position::Absolute,
    ]),
    choice!("flexDirection", flex_direction, [
        "row" => FlexDirection::Row,
        "column" => FlexDirection::Column,
        "row-reverse" => FlexDirection::RowReverse,
        "column-reverse" => FlexDirection::ColumnReverse,
    ]),
    choice!("flexWrap", flex_wrap, [
        "nowrap" => FlexWrap::NoWrap,
        "wrap" => FlexWrap::Wrap,
        "wrap-reverse" => FlexWrap::WrapReverse,
    ]),
    choice!("alignContent", align_content, [
        "stretch" => AlignContent::Stretch,
        "start" => AlignContent::Start,
        "end" => AlignContent::End,
        "center" => AlignContent::Center,
        "space-between" => AlignContent::SpaceBetween,
        "space-around" => AlignContent::SpaceAround,
        "space-evenly" => AlignContent::SpaceEvenly,
    ]),
    choice!("justifyContent", justify_content, [
        "start" => JustifyContent::Start,
        "end" => JustifyContent::End,
        "center" => JustifyContent::Center,
        "space-between" => JustifyContent::SpaceBetween,
        "space-around" => JustifyContent::SpaceAround,
        "space-evenly" => JustifyContent::SpaceEvenly,
    ]),
    choice!("alignItems", align_items, [
        "start" => ALIGN[0].1,
        "end" => ALIGN[1].1,
        "center" => ALIGN[2].1,
        "stretch" => ALIGN[3].1,
    ]),
    Prop {
        name: "alignSelf",
        kind: Kind::Enum(&["auto", "start", "end", "center", "stretch"]),
        apply: |s, v| {
            s.align_self = match v {
                Value::Enum(0) => Some(None),
                Value::Enum(i) => ALIGN.get(*i as usize - 1).map(|a| Some(a.1)),
                _ => None,
            }
        },
    },
    number!("flexGrow", flex_grow),
    number!("flexShrink", flex_shrink),
    length!("flexBasis", flex_basis),
    number!("rowGap", row_gap),
    number!("columnGap", column_gap),
    length!("width", width),
    length!("height", height),
    length!("minWidth", min_width),
    length!("minHeight", min_height),
    length!("maxWidth", max_width),
    length!("maxHeight", max_height),
    length!("marginTop", margin_top),
    length!("marginRight", margin_right),
    length!("marginBottom", margin_bottom),
    length!("marginLeft", margin_left),
    number!("paddingTop", padding_top),
    number!("paddingRight", padding_right),
    number!("paddingBottom", padding_bottom),
    number!("paddingLeft", padding_left),
    length!("top", inset_top),
    length!("right", inset_right),
    length!("bottom", inset_bottom),
    length!("left", inset_left),
    number!("borderTopWidth", border_top_width),
    number!("borderRightWidth", border_right_width),
    number!("borderBottomWidth", border_bottom_width),
    number!("borderLeftWidth", border_left_width),
    color!("borderColor", border_color),
    number!("borderTopLeftRadius", radius_top_left),
    number!("borderTopRightRadius", radius_top_right),
    number!("borderBottomRightRadius", radius_bottom_right),
    number!("borderBottomLeftRadius", radius_bottom_left),
    number!("outlineWidth", outline_width),
    number!("outlineOffset", outline_offset),
    color!("outlineColor", outline_color),
    color!("backgroundColor", background),
    Prop {
        name: "aspectRatio",
        kind: Kind::Number,
        apply: |s, v| s.aspect_ratio = v.number().map(Some),
    },
    Prop {
        name: "boxShadow",
        kind: Kind::Shadows,
        apply: |s, v| {
            s.shadows = match v {
                Value::Shadows(list) => Some(list.clone()),
                _ => None,
            }
        },
    },
    number!("opacity", opacity),
    number!("blur", blur),
    number!("backdropBlur", backdrop_blur),
    number!("translateX", translate_x),
    number!("translateY", translate_y),
    number!("scaleX", scale_x),
    number!("scaleY", scale_y),
    number!("rotate", rotate),
    number!("transformOriginX", transform_origin_x),
    number!("transformOriginY", transform_origin_y),
    Prop {
        name: "zIndex",
        kind: Kind::Number,
        apply: |s, v| s.z_index = v.number().map(|z| Some(z.round() as i32)),
    },
    choice!("overflowX", overflow_x, [
        "visible" => Overflow::Visible,
        "hidden" => Overflow::Hidden,
        "scroll" => Overflow::Scroll,
    ]),
    choice!("overflowY", overflow_y, [
        "visible" => Overflow::Visible,
        "hidden" => Overflow::Hidden,
        "scroll" => Overflow::Scroll,
    ]),
    color!("color", color),
    Prop {
        name: "fontFamily",
        kind: Kind::String,
        apply: |s, v| {
            s.font_family = match v {
                Value::String(name) => Some(FontFamily((*name).into())),
                _ => None,
            }
        },
    },
    number!("fontSize", font_size),
    Prop {
        name: "fontWeight",
        kind: Kind::Number,
        apply: |s, v| s.font_weight = v.number().map(|w| FontWeight(w.clamp(1.0, 1000.0) as u16)),
    },
    choice!("fontStyle", font_style, [
        "normal" => FontStyle::Normal,
        "italic" => FontStyle::Italic,
    ]),
    Prop {
        name: "lineHeight",
        kind: Kind::Length,
        apply: |s, v| {
            s.line_height = match *v {
                Value::Length(unit::AUTO, _) => Some(LineHeight::Normal),
                Value::Length(unit::PX, px) => Some(LineHeight::Px(px)),
                Value::Length(unit::PERCENT, p) => Some(LineHeight::Relative(p / 100.0)),
                Value::Length(_, n) | Value::Number(n) => Some(LineHeight::Relative(n)),
                _ => None,
            }
        },
    },
    number!("letterSpacing", letter_spacing),
    choice!("textAlign", text_align, [
        "start" => TextAlign::Start,
        "end" => TextAlign::End,
        "left" => TextAlign::Left,
        "center" => TextAlign::Center,
        "right" => TextAlign::Right,
    ]),
    choice!("whiteSpace", white_space, [
        "pre-wrap" => WhiteSpace::PreWrap,
        "pre" => WhiteSpace::Pre,
    ]),
    flag!("underline", underline),
    flag!("strikethrough", strikethrough),
    Prop {
        name: "textShadow",
        kind: Kind::Shadows,
        apply: |s, v| {
            s.text_shadows = match v {
                Value::Shadows(list) => Some(
                    list.iter()
                        .map(|b| TextShadow {
                            offset_x: b.offset_x,
                            offset_y: b.offset_y,
                            blur: b.blur,
                            color: b.color,
                        })
                        .collect(),
                ),
                _ => None,
            }
        },
    },
    // Strokes travel as shadows: the width of each as its spread.
    Prop {
        name: "textStroke",
        kind: Kind::Shadows,
        apply: |s, v| {
            s.text_strokes = match v {
                Value::Shadows(list) => Some(
                    list.iter()
                        .map(|b| TextStroke {
                            width: b.spread,
                            color: b.color,
                        })
                        .collect(),
                ),
                _ => None,
            }
        },
    },
    choice!("paintOrder", paint_order, [
        "normal" => PaintOrder::Normal,
        "stroke" => PaintOrder::Stroke,
    ]),
    choice!("objectFit", object_fit, [
        "fill" => ObjectFit::Fill,
        "contain" => ObjectFit::Contain,
        "cover" => ObjectFit::Cover,
        "none" => ObjectFit::None,
        "scale-down" => ObjectFit::ScaleDown,
    ]),
    Prop {
        name: "objectPositionX",
        kind: Kind::Length,
        apply: |s, v| s.object_position = object_position(s, v.length(), None),
    },
    Prop {
        name: "objectPositionY",
        kind: Kind::Length,
        apply: |s, v| s.object_position = object_position(s, None, v.length()),
    },
    choice!("imageRendering", image_rendering, [
        "auto" => ImageRendering::Auto,
        "pixelated" => ImageRendering::Pixelated,
    ]),
    // The shapes of an `<svg>`.
    Prop { name: "fill", kind: Kind::Numbers, apply: |s, v| s.fill_paint = v.numbers().and_then(paint) },
    Prop { name: "stroke", kind: Kind::Numbers, apply: |s, v| s.stroke_paint = v.numbers().and_then(paint) },
    number!("strokeWidth", stroke_width),
    number!("fillOpacity", fill_opacity),
    number!("strokeOpacity", stroke_opacity),
    choice!("fillRule", fill_rule, [
        "nonzero" => FillRule::NonZero,
        "evenodd" => FillRule::EvenOdd,
    ]),
    choice!("strokeLinecap", line_cap, [
        "butt" => LineCap::Butt,
        "round" => LineCap::Round,
        "square" => LineCap::Square,
    ]),
    choice!("strokeLinejoin", line_join, [
        "miter" => LineJoin::Miter,
        "round" => LineJoin::Round,
        "bevel" => LineJoin::Bevel,
    ]),
    number!("strokeMiterlimit", miter_limit),
    // No numbers is `none`.
    Prop {
        name: "strokeDasharray",
        kind: Kind::Numbers,
        apply: |s, v| s.dash_array = v.numbers().map(|n| (!n.is_empty()).then(|| n.into())),
    },
    number!("strokeDashoffset", dash_offset),
    choice!("vectorEffect", non_scaling_stroke, [
        "none" => false,
        "non-scaling-stroke" => true,
    ]),
];

/// `object-position` with one of its halves changed; the other stays, or is the middle.
fn object_position(s: &Style, x: Option<Length>, y: Option<Length>) -> Option<(Length, Length)> {
    let middle = Length::Percent(50.0);
    let (old_x, old_y) = s.object_position.unwrap_or((middle, middle));
    let (x, y) = (x.unwrap_or(old_x), y.unwrap_or(old_y));
    (x != middle || y != middle).then_some((x, y))
}

pub fn get(id: u32) -> Option<&'static Prop> {
    PROPS.get(id as usize)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_unique() {
        let mut names: Vec<_> = PROPS.iter().map(|p| p.name).collect();
        names.sort_unstable();
        let before = names.len();
        names.dedup();
        assert_eq!(before, names.len());
    }

    #[test]
    fn values_land_in_their_fields() {
        let mut s = Style::default();
        let id = PROPS.iter().position(|p| p.name == "opacity").unwrap();
        (PROPS[id].apply)(&mut s, &Value::Number(0.5));
        assert_eq!(s.opacity, Some(0.5));
        (PROPS[id].apply)(&mut s, &Value::Unset);
        assert_eq!(s.opacity, None);

        let id = PROPS.iter().position(|p| p.name == "width").unwrap();
        (PROPS[id].apply)(&mut s, &Value::Length(unit::PERCENT, 50.0));
        assert_eq!(s.width, Some(Length::Percent(50.0)));

        let id = PROPS.iter().position(|p| p.name == "alignSelf").unwrap();
        (PROPS[id].apply)(&mut s, &Value::Enum(0));
        assert_eq!(s.align_self, Some(None));
        (PROPS[id].apply)(&mut s, &Value::Enum(3));
        assert_eq!(s.align_self, Some(Some(AlignItems::Center)));
    }
}
