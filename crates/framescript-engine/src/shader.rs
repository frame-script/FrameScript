//! WGSL that a composition writes, for a box of its own (`<Shader>`) or for the surface of a thing in
//! 3D (a material).
//!
//! The composition's code comes first and what FrameScript adds after it, so that the lines of what
//! goes wrong are those of the composition's file (WGSL doesn't mind in what order things are
//! declared). The code is parsed and validated with naga when the scripts ask for it
//! (`op_fs_shader`), and what is wrong is thrown there, as any other error of the scripts. The
//! uniforms of `@group(1)` are read from it too: the scripts give their values by name, and they
//! are laid out here as WGSL lays them out.
//!
//! WGSL はコンポジションのコードを先に、FrameScript が足すものを後に置く。行番号がそのファイルのものになる。

use naga::{AddressSpace, ArraySize, Module, ScalarKind, TypeInner};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

/// What the code is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Stage {
    /// All of a box: `fn shade(uv: vec2f) -> vec4f`, or a `@fragment` of its own.
    Flat,
    /// The surface of a thing in 3D: `surface`, `fragment` and `vertex`, all of them optional.
    Material,
}

impl Stage {
    pub fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Stage::Flat),
            1 => Some(Stage::Material),
            _ => None,
        }
    }
}

/// Which of the functions FrameScript calls the code has.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Hooks {
    pub shade: bool,
    pub surface: bool,
    pub fragment: bool,
    pub vertex: bool,
}

/// Compiled code, with what the scripts and the renderers need to know of it.
pub struct Shader {
    /// The renderers keep what they make of it by this.
    pub id: u64,
    pub stage: Stage,
    /// All of it: the composition's code, then FrameScript's.
    pub code: String,
    pub hooks: Hooks,
    /// The uniform buffer of `@group(1)`, if there is one.
    pub uniforms: Option<Block>,
    /// The textures of `@group(1)`, in the order they are declared.
    pub textures: Vec<Binding>,
    /// The samplers of `@group(1)`.
    pub samplers: Vec<u32>,
    /// Whether it reads `fs.time` or `fs.frame`: if not, it doesn't have to be drawn again when only
    /// the time changes.
    pub uses_time: bool,
}

/// A uniform buffer, and where the numbers of each of its members go.
pub struct Block {
    pub binding: u32,
    /// In bytes, a multiple of 16.
    pub size: u32,
    pub members: Vec<Member>,
}

pub struct Member {
    pub name: String,
    /// As WGSL writes it, for what is said when the values don't fit.
    pub ty: String,
    /// Where each number goes, in the order they are given.
    pub slots: Vec<Slot>,
}

#[derive(Clone, Copy, Debug)]
pub struct Slot {
    pub offset: u32,
    pub kind: Number,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Number {
    F32,
    I32,
    U32,
}

pub struct Binding {
    pub name: String,
    pub binding: u32,
}

impl Shader {
    /// Compiles `source` (from the file `path`, for what is said when it is wrong) for `stage`.
    pub fn compile(source: &str, path: &str, stage: Stage) -> Result<Self, String> {
        let hooks = Hooks {
            shade: declares(source, "shade"),
            surface: declares(source, "surface"),
            fragment: declares(source, "fragment"),
            vertex: declares(source, "vertex"),
        };
        let code = format!("{source}\n{}", added(stage, hooks));
        let module = naga::front::wgsl::parse_str(&code)
            .map_err(|e| e.emit_to_string_with_path(&code, path))?;
        naga::valid::Validator::new(
            naga::valid::ValidationFlags::all(),
            naga::valid::Capabilities::default(),
        )
        .validate(&module)
        .map_err(|e| e.emit_to_string_with_path(&code, path))?;
        if stage == Stage::Flat && !hooks.shade && !module.entry_points.iter().any(is_fragment) {
            return Err(format!(
                "{path}: a <Shader> needs `fn shade(uv: vec2f) -> vec4f`, or a @fragment of its own"
            ));
        }

        let mut uniforms = None;
        let mut textures = Vec::new();
        let mut samplers = Vec::new();
        for (_, var) in module.global_variables.iter() {
            let Some(binding) = &var.binding else {
                continue;
            };
            let name = var.name.clone().unwrap_or_default();
            if binding.group != 1 {
                if is_ours(&name) {
                    continue;
                }
                return Err(format!(
                    "{path}: `{name}` is in @group({}); what a shader is given goes in @group(1)",
                    binding.group
                ));
            }
            match (&var.space, &module.types[var.ty].inner) {
                (AddressSpace::Uniform, _) => {
                    if uniforms.is_some() {
                        return Err(format!(
                            "{path}: one uniform buffer in @group(1) is enough: put `{name}` in the other"
                        ));
                    }
                    uniforms = Some(block(&module, var.ty, binding.binding, path)?);
                }
                (AddressSpace::Handle, TypeInner::Image { dim, arrayed, class }) => {
                    let sampled_float = matches!(
                        class,
                        naga::ImageClass::Sampled {
                            kind: ScalarKind::Float,
                            multi: false
                        }
                    );
                    if *dim != naga::ImageDimension::D2 || *arrayed || !sampled_float {
                        return Err(format!("{path}: `{name}` has to be a texture_2d<f32>"));
                    }
                    textures.push(Binding {
                        name,
                        binding: binding.binding,
                    });
                }
                (AddressSpace::Handle, TypeInner::Sampler { comparison: false }) => {
                    samplers.push(binding.binding);
                }
                _ => {
                    return Err(format!(
                        "{path}: `{name}` can't be given to a shader; @group(1) takes one uniform \
                         buffer, texture_2d<f32> and sampler"
                    ));
                }
            }
        }
        static NEXT: AtomicU64 = AtomicU64::new(1);
        Ok(Self {
            id: NEXT.fetch_add(1, Ordering::Relaxed),
            stage,
            uses_time: source.contains("fs.time") || source.contains("fs.frame"),
            code,
            hooks,
            uniforms,
            textures,
            samplers,
        })
    }

    /// The bytes of the uniform buffer with nothing given: all zero.
    pub fn blank_uniforms(&self) -> Vec<u8> {
        vec![0; self.uniforms.as_ref().map_or(0, |b| b.size as usize)]
    }

    /// Writes `values` as the member `member` into `bytes`, which is as big as the buffer.
    pub fn write_uniform(&self, bytes: &mut [u8], member: usize, values: &[f32]) -> Result<(), String> {
        let Some(m) = self.uniforms.as_ref().and_then(|b| b.members.get(member)) else {
            return Err(format!("the shader has no uniform number {member}"));
        };
        if values.len() != m.slots.len() {
            return Err(format!(
                "`{}` is a {}, which takes {} numbers, not {}",
                m.name,
                m.ty,
                m.slots.len(),
                values.len()
            ));
        }
        for (slot, &v) in m.slots.iter().zip(values) {
            let word = match slot.kind {
                Number::F32 => v.to_bits(),
                Number::I32 => (v.round() as i32) as u32,
                Number::U32 => v.round().max(0.0) as u32,
            };
            let at = slot.offset as usize;
            if let Some(b) = bytes.get_mut(at..at + 4) {
                b.copy_from_slice(&word.to_le_bytes());
            }
        }
        Ok(())
    }
}

fn is_fragment(e: &naga::EntryPoint) -> bool {
    e.stage == naga::ShaderStage::Fragment
}

/// The globals that FrameScript adds start with `fs`.
fn is_ours(name: &str) -> bool {
    name == "fs" || name.starts_with("fs_")
}

/// Whether `source` declares `fn <name>(`. Comments aren't told apart, which is good enough to know
/// what to call.
fn declares(source: &str, name: &str) -> bool {
    let mut rest = source;
    while let Some(at) = rest.find("fn") {
        let before = rest[..at].chars().next_back();
        let after = rest[at + 2..].trim_start();
        let word_starts = before.is_none_or(|c| !(c.is_alphanumeric() || c == '_'));
        if word_starts
            && rest[at + 2..].starts_with(char::is_whitespace)
            && let Some(tail) = after.strip_prefix(name)
            && tail.trim_start().starts_with('(')
        {
            return true;
        }
        rest = &rest[at + 2..];
    }
    false
}

fn block(module: &Module, ty: naga::Handle<naga::Type>, binding: u32, path: &str) -> Result<Block, String> {
    let TypeInner::Struct { members, span } = &module.types[ty].inner else {
        // A uniform of one value: a block of one member, named for nothing.
        let mut slots = Vec::new();
        flatten(module, ty, 0, &mut slots).map_err(|e| format!("{path}: {e}"))?;
        return Ok(Block {
            binding,
            size: round16(module.types[ty].inner.size(module.to_ctx())),
            members: vec![Member {
                name: String::new(),
                ty: describe(module, ty),
                slots,
            }],
        });
    };
    let mut out = Vec::with_capacity(members.len());
    for m in members {
        let name = m.name.clone().unwrap_or_default();
        let mut slots = Vec::new();
        flatten(module, m.ty, m.offset, &mut slots).map_err(|e| format!("{path}: `{name}`: {e}"))?;
        out.push(Member {
            name,
            ty: describe(module, m.ty),
            slots,
        });
    }
    Ok(Block {
        binding,
        size: round16(*span),
        members: out,
    })
}

fn round16(n: u32) -> u32 {
    n.div_ceil(16).max(1) * 16
}

/// Where the numbers of a value of type `ty` at `offset` go, in the order they are written.
fn flatten(module: &Module, ty: naga::Handle<naga::Type>, offset: u32, out: &mut Vec<Slot>) -> Result<(), String> {
    let number = |s: naga::Scalar| match (s.kind, s.width) {
        (ScalarKind::Float, 4) => Ok(Number::F32),
        (ScalarKind::Sint, 4) => Ok(Number::I32),
        (ScalarKind::Uint, 4) => Ok(Number::U32),
        _ => Err(format!("{} numbers can't be given from TypeScript", describe(module, ty))),
    };
    match &module.types[ty].inner {
        TypeInner::Scalar(s) => out.push(Slot {
            offset,
            kind: number(*s)?,
        }),
        TypeInner::Vector { size, scalar } => {
            let kind = number(*scalar)?;
            for i in 0..*size as u32 {
                out.push(Slot {
                    offset: offset + 4 * i,
                    kind,
                });
            }
        }
        TypeInner::Matrix { columns, rows, scalar } => {
            let kind = number(*scalar)?;
            let stride = if *rows as u32 == 2 { 8 } else { 16 };
            for c in 0..*columns as u32 {
                for r in 0..*rows as u32 {
                    out.push(Slot {
                        offset: offset + c * stride + 4 * r,
                        kind,
                    });
                }
            }
        }
        TypeInner::Array {
            base,
            size: ArraySize::Constant(n),
            stride,
        } => {
            for i in 0..n.get() {
                flatten(module, *base, offset + i * stride, out)?;
            }
        }
        TypeInner::Struct { members, .. } => {
            for m in members {
                flatten(module, m.ty, offset + m.offset, out)?;
            }
        }
        _ => return Err(format!("a {} can't be given from TypeScript", describe(module, ty))),
    }
    Ok(())
}

/// The type as WGSL writes it, near enough.
fn describe(module: &Module, ty: naga::Handle<naga::Type>) -> String {
    let t = &module.types[ty];
    if let Some(name) = &t.name {
        return name.clone();
    }
    let scalar = |s: naga::Scalar| match (s.kind, s.width) {
        (ScalarKind::Float, 4) => "f32",
        (ScalarKind::Float, 2) => "f16",
        (ScalarKind::Sint, _) => "i32",
        (ScalarKind::Uint, _) => "u32",
        (ScalarKind::Bool, _) => "bool",
        _ => "number",
    };
    let suffix = |s: naga::Scalar| match scalar(s) {
        "f32" => "f".to_string(),
        "i32" => "i".to_string(),
        "u32" => "u".to_string(),
        other => format!("<{other}>"),
    };
    match &t.inner {
        TypeInner::Scalar(s) => scalar(*s).into(),
        TypeInner::Vector { size, scalar: s } => format!("vec{}{}", *size as u32, suffix(*s)),
        TypeInner::Matrix { columns, rows, scalar: s } => {
            format!("mat{}x{}{}", *columns as u32, *rows as u32, suffix(*s))
        }
        TypeInner::Array {
            base,
            size: ArraySize::Constant(n),
            ..
        } => format!("array<{}, {n}>", describe(module, *base)),
        TypeInner::Array { base, .. } => format!("array<{}>", describe(module, *base)),
        _ => "value".into(),
    }
}

/// What FrameScript adds after the composition's code.
fn added(stage: Stage, hooks: Hooks) -> String {
    match stage {
        Stage::Flat => {
            let mut s = String::from(FLAT);
            if hooks.shade {
                s.push_str(FLAT_SHADE);
            }
            s
        }
        Stage::Material => crate::space::material_code(hooks),
    }
}

/// What every `<Shader>` has: `fs`, and the triangle that covers the box.
const FLAT: &str = r#"
// ---- FrameScript ----
struct FrameScript {
    /// The size of the box, in its pixels.
    resolution: vec2f,
    /// Seconds into the clip.
    time: f32,
    /// The frame of the clip.
    frame: f32,
}
@group(0) @binding(0) var<uniform> fs: FrameScript;

struct FsVarying {
    @builtin(position) position: vec4f,
    /// (0, 0) at the top left of the box, (1, 1) at the bottom right.
    @location(0) uv: vec2f,
}

@vertex
fn fs_vertex(@builtin(vertex_index) i: u32) -> FsVarying {
    let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
    var out: FsVarying;
    out.position = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
    out.uv = uv;
    return out;
}

/// Light (linear) to what is stored, as sRGB does it.
fn fs_encode(light: vec3f) -> vec3f {
    let l = clamp(light, vec3f(0.0), vec3f(1.0));
    return select(1.055 * pow(l, vec3f(1.0 / 2.4)) - 0.055, l * 12.92, l <= vec3f(0.0031308));
}

/// What a @fragment of the box gives back for a color of light with straight alpha.
fn fs_output(color: vec4f) -> vec4f {
    let a = clamp(color.a, 0.0, 1.0);
    return vec4f(fs_encode(color.rgb) * a, a);
}
"#;

const FLAT_SHADE: &str = r#"
@fragment
fn fs_fragment(in: FsVarying) -> @location(0) vec4f {
    return fs_output(shade(in.uv));
}
"#;

/// The size of [`FLAT`]'s `FrameScript`.
pub const FLAT_GLOBALS: u64 = 16;

/// A picture for a shader, decoded once.
pub struct Picture {
    pub id: u64,
    pub width: u32,
    pub height: u32,
    /// RGBA, sRGB, not premultiplied.
    pub pixels: Vec<u8>,
}

impl Picture {
    pub fn load(path: &std::path::Path) -> Result<Arc<Self>, String> {
        let image = image::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let rgba = image.to_rgba8();
        static NEXT: AtomicU64 = AtomicU64::new(1);
        Ok(Arc::new(Self {
            id: NEXT.fetch_add(1, Ordering::Relaxed),
            width: rgba.width(),
            height: rgba.height(),
            pixels: rgba.into_raw(),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_is_wrong_is_said_at_the_line_of_the_file() {
        let source = "fn shade(uv: vec2f) -> vec4f {\n    return vec4f(uv, nope, 1.0);\n}\n";
        let e = Shader::compile(source, "plasma.wgsl", Stage::Flat).err().expect("it is wrong");
        assert!(e.contains("plasma.wgsl:2:"), "{e}");
        assert!(e.contains("nope"), "{e}");
    }

    #[test]
    fn uniforms_are_laid_out_as_wgsl_lays_them_out() {
        let source = r#"
struct Uniforms {
    color: vec4f,
    speed: f32,
    center: vec3f,
    count: i32,
    turn: mat3x3f,
    steps: array<vec4f, 2>,
}
@group(1) @binding(0) var<uniform> u: Uniforms;
@group(1) @binding(1) var photo: texture_2d<f32>;
@group(1) @binding(2) var linear: sampler;
fn shade(uv: vec2f) -> vec4f {
    return u.color * u.speed + textureSample(photo, linear, uv) * fs.time;
}
"#;
        let s = Shader::compile(source, "a.wgsl", Stage::Flat).unwrap();
        let b = s.uniforms.as_ref().unwrap();
        let names: Vec<_> = b.members.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, ["color", "speed", "center", "count", "turn", "steps"]);
        let offsets = |i: usize| b.members[i].slots.iter().map(|s| s.offset).collect::<Vec<_>>();
        assert_eq!(offsets(0), [0, 4, 8, 12]);
        assert_eq!(offsets(1), [16]);
        assert_eq!(offsets(2), [32, 36, 40], "a vec3f is aligned to 16");
        assert_eq!(offsets(3), [44], "and what follows fills in after it");
        assert_eq!(offsets(4), [48, 52, 56, 64, 68, 72, 80, 84, 88], "columns of 16");
        assert_eq!(offsets(5), [96, 100, 104, 108, 112, 116, 120, 124]);
        assert_eq!(b.size, 128);
        assert_eq!(b.members[4].ty, "mat3x3f");
        assert_eq!(s.textures.len(), 1);
        assert_eq!(s.textures[0].name, "photo");
        assert_eq!(s.samplers, [2]);
        assert!(s.uses_time);
        assert!(s.hooks.shade);

        let mut bytes = s.blank_uniforms();
        s.write_uniform(&mut bytes, 3, &[-2.0]).unwrap();
        assert_eq!(&bytes[44..48], &(-2i32).to_le_bytes());
        let e = s.write_uniform(&mut bytes, 2, &[1.0, 2.0]).unwrap_err();
        assert!(e.contains("vec3f") && e.contains("3 numbers"), "{e}");
    }

    #[test]
    fn what_goes_where_fs_does_is_refused() {
        let source = "@group(0) @binding(3) var<uniform> mine: f32;\nfn shade(uv: vec2f) -> vec4f { return vec4f(mine); }";
        let e = Shader::compile(source, "a.wgsl", Stage::Flat).err().unwrap();
        assert!(e.contains("@group(1)"), "{e}");
    }

    #[test]
    fn a_box_needs_something_to_shade_it() {
        let e = Shader::compile("fn other() {}", "a.wgsl", Stage::Flat).err().unwrap();
        assert!(e.contains("fn shade"), "{e}");
        assert!(declares("fn  shade (uv: vec2f)", "shade"));
        assert!(!declares("fn shader(uv: vec2f)", "shade"));
        assert!(!declares("myfn shade(", "shade"));
    }
}
