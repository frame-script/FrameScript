//! A loaded project: its scripts in V8, and the document they build in AntiWebUI.
//!
//! The document is an AntiWebUI [`Ui`] with no window: it is laid out and painted like any other,
//! and what comes out is a [`Scene`], which is `Send` and can be drawn by whatever thread has a
//! GPU (the preview in the studio, or a renderer of its own when exporting).

use crate::commands::Nodes;
use crate::ext::{self, Bridge, SharedBridge};
use crate::loader::{Loader, default_library_dir};
use crate::media::{Media, MediaNodes};
use crate::sound::{AudioClip, AudioPlan};
use anti_webui_core::Ui;
use anti_webui_core::event::WindowEvent;
use anti_webui_core::geometry::{Scale, SizeI};
use anti_webui_core::scene::Scene;
use anti_webui_core::style::{Display, Length, Overflow, Position};
use anti_webui_core::tree::with_doc;
use anti_webui_core::window::in_window;
use anti_webui_core::view::{IntoView, div, node_ref};
use deno_core::v8;
use deno_core::{JsRuntime, ModuleSpecifier, PollEventLoopOptions, RuntimeOptions};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// `framescript.json` in the project's directory.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectSettings {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    /// The module whose default export is the root component, relative to the project.
    pub entry: String,
    /// A CSS color behind everything.
    pub background: String,
    /// In seconds. Without it, the project lasts as long as its clips.
    pub duration: Option<f64>,
}

impl Default for ProjectSettings {
    fn default() -> Self {
        Self {
            name: "untitled".into(),
            width: 1920,
            height: 1080,
            fps: 60.0,
            entry: "main.tsx".into(),
            background: "#000000".into(),
            duration: None,
        }
    }
}

impl ProjectSettings {
    /// `framescript.json` in `dir`.
    pub fn read(dir: &Path) -> Result<Self, Error> {
        read_settings(dir)
    }
}

/// What the scripts made of the project, for the timeline.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub duration_frames: u32,
    pub clips: Vec<ClipInfo>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClipInfo {
    pub id: u32,
    pub label: Option<String>,
    /// The first frame, in the frames of the project.
    pub start: u32,
    /// The frame after the last one.
    pub end: u32,
    /// How many clips it is in.
    pub depth: u32,
    pub parent: Option<u32>,
}

#[derive(Debug)]
pub enum Error {
    /// `framescript.json` is missing or wrong.
    Settings(String),
    /// The scripts threw, or wouldn't load.
    Script(String),
    /// The library sent something it shouldn't have: a bug of FrameScript.
    Bridge(String),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Error::Settings(e) => write!(f, "framescript.json: {e}"),
            Error::Script(e) => f.write_str(e),
            Error::Bridge(e) => write!(f, "internal error in the command buffer: {e}"),
        }
    }
}

impl std::error::Error for Error {}

impl From<deno_core::error::CoreError> for Error {
    fn from(e: deno_core::error::CoreError) -> Self {
        Error::Script(e.to_string())
    }
}

/// How long the parts of making a frame took.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FrameTimings {
    /// Running the effects that depend on the frame, and applying what they changed.
    pub script: Duration,
    /// Styles, layout and positions.
    pub layout: Duration,
    pub paint: Duration,
}

/// How long a frame may wait for what it shows.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Wait {
    /// Until everything is there: what a render needs.
    Exact,
    /// So long for each video, and then the closest of its frames there is, for a preview that
    /// will be told when the right ones come (see [`Media::set_listener`]).
    Upto(Duration),
}

impl Wait {
    /// About a frame of the display.
    pub const PREVIEW: Wait = Wait::Upto(Duration::from_millis(15));
}

/// How long anything waits for what it shows, at most.
const EXACT_WAIT: Duration = Duration::from_secs(10);

pub struct Rendered {
    pub scene: Scene,
    pub timings: FrameTimings,
    /// Whether everything shows as it should: with [`Wait::Upto`], a video can show another of
    /// its frames.
    pub complete: bool,
}

pub struct Composition {
    // Dropped before `ui`: the scripts hold handles to its nodes.
    runtime: JsRuntime,
    /// What V8's delayed tasks (like those of the GC) are run on; it outlives `runtime`. The
    /// runtime is made inside it.
    _tokio: tokio::runtime::Runtime,
    seek: v8::Global<v8::Function>,
    bridge: SharedBridge,
    ui: Ui,
    settings: ProjectSettings,
    info: ProjectInfo,
    audio: Arc<AudioPlan>,
    dir: PathBuf,
    /// The time `paint` is told frame 0 is at: what depends on time in AntiWebUI then goes by the
    /// frame, not by the clock.
    epoch: Instant,
    size: (u32, u32),
    frame: Option<u32>,
}

impl Composition {
    /// Loads the project in `dir`. The document starts at the project's own size; see
    /// [`Composition::fit`].
    pub fn load(dir: &Path) -> Result<Self, Error> {
        Self::load_with(dir, Media::new())
    }

    /// Loads the project in `dir`, with videos from `media`, which may have frames of them
    /// already.
    pub fn load_with(dir: &Path, media: Media) -> Result<Self, Error> {
        let settings = read_settings(dir)?;
        let dir = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
        let library = default_library_dir();
        let library = library.canonicalize().unwrap_or(library);

        let stage = node_ref();
        let (width, height) = (settings.width as f32, settings.height as f32);
        let ui = Ui::new(move || div().node_ref(stage).into_view());
        let stage = stage.get().expect("the stage was just made");
        with_doc(|d| {
            let n = d.get_mut(stage).expect("the stage was just made");
            let s = &mut n.style.base;
            s.display = Some(Display::Flex);
            s.position = Some(Position::Relative);
            s.width = Some(Length::Px(width));
            s.height = Some(Length::Px(height));
            s.flex_shrink = Some(0.0);
            s.overflow_x = Some(Overflow::Hidden);
            s.overflow_y = Some(Overflow::Hidden);
            d.mark_style_of(stage);
        });

        let bridge: SharedBridge = Rc::new(RefCell::new(Bridge {
            nodes: Nodes::new(stage),
            media: MediaNodes::new(media, dir.clone()),
            drawn: Default::default(),
            fault: None,
        }));
        // Loading goes through futures (imports could be fetched), and V8 posts tasks for later:
        // both run on a runtime on this thread. The files are read at once, so loading is driven to
        // the end right here.
        let tokio = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .expect("a runtime on the current thread can be made");
        let mut runtime = {
            let _inside = tokio.enter();
            JsRuntime::new(RuntimeOptions {
                extensions: vec![ext::framescript::init(bridge.clone())],
                module_loader: Some(Rc::new(Loader::new(&library))),
                ..Default::default()
            })
        };

        let url = |p: &Path| {
            ModuleSpecifier::from_file_path(p)
                .map_err(|_| Error::Settings(format!("{} is not a file path", p.display())))
        };
        let entry = dir.join(&settings.entry);
        if !entry.is_file() {
            return Err(Error::Settings(format!("the entry {} does not exist", entry.display())));
        }
        let source = format!(
            "import {{ mount }} from \"framescript/host\";\n\
             import * as project from {entry};\n\
             mount(project, {settings});\n",
            entry = json(url(&entry)?.as_str()),
            settings = serde_json::to_string(&settings).expect("settings serialize"),
        );
        let main = url(&dir.join("__framescript_entry__.js"))?;
        // The ops work on the current document of the thread: it has to be this one.
        in_window(ui.window(), || {
            tokio.block_on(async {
                let id = runtime.load_main_es_module_from_code(&main, source).await?;
                let evaluated = runtime.mod_evaluate(id);
                runtime.run_event_loop(PollEventLoopOptions::default()).await?;
                evaluated.await
            })
        })?;
        check(&bridge)?;

        let info: ProjectInfo = call(&mut runtime, "__fs_info")?;
        let clips: Vec<AudioClip> = call(&mut runtime, "__fs_audio")?;
        let audio = {
            let bridge = bridge.borrow();
            let fps = settings.fps.max(1.0);
            Arc::new(AudioPlan::new(
                clips,
                fps,
                info.duration_frames as f64 / fps,
                bridge.media.media(),
                |src| bridge.media.resolve(src),
            ))
        };
        let seek = function(&mut runtime, "__fs_seek")?;

        let mut composition = Self {
            runtime,
            _tokio: tokio,
            seek,
            bridge,
            ui,
            settings,
            info,
            audio,
            dir,
            epoch: Instant::now(),
            size: (0, 0),
            frame: None,
        };
        composition.fit(u32::MAX, u32::MAX);
        Ok(composition)
    }

    pub fn settings(&self) -> &ProjectSettings {
        &self.settings
    }

    pub fn info(&self) -> &ProjectInfo {
        &self.info
    }

    /// What sound plays when. It is the same until the project is loaded again.
    pub fn audio(&self) -> &Arc<AudioPlan> {
        &self.audio
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// The size of what [`Composition::render`] paints, in pixels.
    pub fn size(&self) -> (u32, u32) {
        self.size
    }

    /// Paints at the largest scale, up to the project's own size, that fits `width` × `height`
    /// pixels. The scale is a multiple of 1/120 (AntiWebUI's), and the size is what the project's
    /// size comes to at it, so the layout is the project's whatever the size.
    pub fn fit(&mut self, width: u32, height: u32) {
        let (w, h) = (self.settings.width.max(1) as f64, self.settings.height.max(1) as f64);
        let ratio = (width as f64 / w).min(height as f64 / h).min(1.0);
        self.set_scale(Scale(((ratio * 120.0).floor() as u32).max(1)));
    }

    /// Paints at `ratio` of the project's own size, more than it too: what is drawn stays sharp,
    /// and only pictures and videos are scaled up. The ratio is rounded to a multiple of 1/120.
    pub fn scale_to(&mut self, ratio: f64) {
        self.set_scale(Scale(((ratio * 120.0).round() as u32).max(1)));
    }

    fn set_scale(&mut self, scale: Scale) {
        let (w, h) = (self.settings.width.max(1) as f64, self.settings.height.max(1) as f64);
        let size = (
            (w * scale.as_f64()).round().max(1.0) as u32,
            (h * scale.as_f64()).round().max(1.0) as u32,
        );
        if size == self.size {
            return;
        }
        self.size = size;
        self.ui.handle_event(WindowEvent::Resized {
            size: SizeI::new(size.0 as i32, size.1 as i32),
            scale,
        });
    }

    /// Makes the picture of `frame`, with everything in it.
    pub fn render(&mut self, frame: u32) -> Result<(Scene, FrameTimings), Error> {
        let r = self.render_with(frame, Wait::Exact)?;
        Ok((r.scene, r.timings))
    }

    /// Makes the picture of `frame`. Making it again after it wasn't complete puts in what has
    /// come since, without running anything of the scripts.
    pub fn render_with(&mut self, frame: u32, wait: Wait) -> Result<Rendered, Error> {
        let mut timings = FrameTimings::default();
        let t = Instant::now();
        if self.frame != Some(frame) {
            let (runtime, seek) = (&mut self.runtime, &self.seek);
            in_window(self.ui.window(), || call_seek(runtime, seek, frame))?;
            check(&self.bridge)?;
            self.frame = Some(frame);
        }
        let wait_for = match wait {
            Wait::Exact => EXACT_WAIT,
            Wait::Upto(d) => d,
        };
        let bridge = &self.bridge;
        let complete = in_window(self.ui.window(), || {
            with_doc(|d| {
                let mut bridge = bridge.borrow_mut();
                bridge.drawn.sync(d);
                bridge.media.show_frames(d, wait_for)
            })
        });
        timings.script = t.elapsed();

        let t = Instant::now();
        self.ui.update();
        // Pictures decode on workers; a frame is only done with them in it.
        if self.ui.wait_for_images(EXACT_WAIT) {
            self.ui.update();
        }
        timings.layout = t.elapsed();

        let t = Instant::now();
        let at = self.epoch + Duration::from_secs_f64(frame as f64 / self.settings.fps.max(1.0));
        let scene = self.ui.paint(at);
        timings.paint = t.elapsed();
        Ok(Rendered {
            scene,
            timings,
            complete,
        })
    }

}

/// Calls `__fs_seek(frame)`, straight through V8 with a number, without serializing anything.
fn call_seek(runtime: &mut JsRuntime, seek: &v8::Global<v8::Function>, frame: u32) -> Result<(), Error> {
    let context = runtime.main_context();
    let isolate = runtime.v8_isolate();
    let scope = std::pin::pin!(v8::HandleScope::new(isolate));
    let mut scope = scope.init();
    let context = v8::Local::new(&scope, context);
    let scope = &mut v8::ContextScope::new(&mut scope, context);
    let catch = std::pin::pin!(v8::TryCatch::new(scope));
    let catch = &mut catch.init();
    let seek = v8::Local::new(catch, seek);
    let recv = v8::undefined(catch).into();
    let arg = v8::Integer::new_from_unsigned(catch, frame).into();
    if seek.call(catch, recv, &[arg]).is_none() {
        let message = match catch.exception() {
            Some(e) => deno_core::error::JsError::from_v8_exception(catch, e).to_string(),
            None => "the seek was cut short".into(),
        };
        return Err(Error::Script(message));
    }
    Ok(())
}

fn read_settings(dir: &Path) -> Result<ProjectSettings, Error> {
    let path = dir.join("framescript.json");
    let text = std::fs::read_to_string(&path)
        .map_err(|e| Error::Settings(format!("{}: {e}", path.display())))?;
    serde_json::from_str(&text).map_err(|e| Error::Settings(e.to_string()))
}

fn check(bridge: &SharedBridge) -> Result<(), Error> {
    match bridge.borrow_mut().fault.take() {
        Some(e) => Err(Error::Bridge(e)),
        None => Ok(()),
    }
}

fn json(s: &str) -> String {
    serde_json::to_string(s).expect("strings serialize")
}

fn function(runtime: &mut JsRuntime, name: &str) -> Result<v8::Global<v8::Function>, Error> {
    let context = runtime.main_context();
    let isolate = runtime.v8_isolate();
    let scope = std::pin::pin!(v8::HandleScope::new(isolate));
    let mut scope = scope.init();
    let context = v8::Local::new(&scope, context);
    let scope = &mut v8::ContextScope::new(&mut scope, context);
    let global = context.global(scope);
    let key = v8::String::new(scope, name).expect("short names fit");
    let value = global
        .get(scope, key.into())
        .ok_or_else(|| Error::Script(format!("{name} is not defined")))?;
    let f = v8::Local::<v8::Function>::try_from(value)
        .map_err(|_| Error::Script(format!("{name} is not a function")))?;
    Ok(v8::Global::new(scope, f))
}

/// Asks the scripts what they made of the project (`__fs_info`, `__fs_audio`), once per load.
fn call<T: serde::de::DeserializeOwned>(runtime: &mut JsRuntime, name: &str) -> Result<T, Error> {
    let info = function(runtime, name)?;
    let context = runtime.main_context();
    let isolate = runtime.v8_isolate();
    let scope = std::pin::pin!(v8::HandleScope::new(isolate));
    let mut scope = scope.init();
    let context = v8::Local::new(&scope, context);
    let scope = &mut v8::ContextScope::new(&mut scope, context);
    let catch = std::pin::pin!(v8::TryCatch::new(scope));
    let catch = &mut catch.init();
    let info = v8::Local::new(catch, info);
    let recv = v8::undefined(catch).into();
    let Some(value) = info.call(catch, recv, &[]) else {
        let message = match catch.exception() {
            Some(e) => deno_core::error::JsError::from_v8_exception(catch, e).to_string(),
            None => format!("{name} was cut short"),
        };
        return Err(Error::Script(message));
    };
    deno_core::serde_v8::from_v8(catch, value).map_err(|e| Error::Bridge(format!("{name}: {e}")))
}
