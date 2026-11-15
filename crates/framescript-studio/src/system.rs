//! What the studio runs on, for the settings' System tab and for reports of what went wrong: the
//! processor, the memory, the system, the GPUs that draw the window and the exports, and the
//! programs behind them.

use anti_webui::gpu::wgpu;
use std::cell::RefCell;
use std::process::{Command, Stdio};

/// A part of what is told: a title and lines of a name and a value.
pub type Section = (&'static str, Vec<(&'static str, String)>);

thread_local! {
    /// The GPU of the window, from when the preview first met it.
    static DISPLAY_GPU: RefCell<Option<wgpu::AdapterInfo>> = const { RefCell::new(None) };
}

/// Called by the preview with the device it draws with.
pub fn note_display_gpu(info: wgpu::AdapterInfo) {
    DISPLAY_GPU.with(|g| *g.borrow_mut() = Some(info));
}

pub fn display_gpu() -> Option<wgpu::AdapterInfo> {
    DISPLAY_GPU.with(|g| g.borrow().clone())
}

/// What can be known at once, without a GPU or FFmpeg to ask.
pub fn at_once() -> Vec<Section> {
    let cpu = std::fs::read_to_string("/proc/cpuinfo").unwrap_or_default();
    let field = |name: &str| {
        cpu.lines()
            .find(|l| l.split(':').next().is_some_and(|k| k.trim() == name))
            .and_then(|l| l.split_once(':'))
            .map(|(_, v)| v.trim().to_string())
    };
    let threads = std::thread::available_parallelism().map_or(0, |n| n.get());
    // Distinct cores, by the package and the core they are on.
    let mut cores: Vec<(String, String)> = Vec::new();
    let (mut package, mut core) = (String::new(), String::new());
    for line in cpu.lines() {
        if let Some((k, v)) = line.split_once(':') {
            match k.trim() {
                "physical id" => package = v.trim().into(),
                "core id" => core = v.trim().into(),
                _ => {}
            }
        } else if !core.is_empty() {
            cores.push((package.clone(), std::mem::take(&mut core)));
        }
    }
    cores.sort();
    cores.dedup();
    let mut processor = vec![(
        "Model",
        field("model name").unwrap_or_else(|| "unknown".into()),
    )];
    processor.push((
        "Threads",
        if cores.is_empty() {
            threads.to_string()
        } else {
            format!("{threads} on {} cores", cores.len())
        },
    ));
    processor.push(("Architecture", std::env::consts::ARCH.into()));
    if let Some(memory) = memory_total() {
        processor.push(("Memory", memory));
    }

    let release = std::fs::read_to_string("/etc/os-release").unwrap_or_default();
    let os = release
        .lines()
        .find_map(|l| l.strip_prefix("PRETTY_NAME="))
        .map(|v| v.trim_matches('"').to_string())
        .unwrap_or_else(|| std::env::consts::OS.into());
    let mut system = vec![("Name", os)];
    if let Ok(kernel) = std::fs::read_to_string("/proc/sys/kernel/osrelease") {
        system.push(("Kernel", kernel.trim().into()));
    }
    let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
    if !session.is_empty() {
        system.push(("Session", session));
    }

    let display = match display_gpu() {
        Some(info) => gpu_lines(&info),
        None => vec![("Adapter", "not drawn yet".into())],
    };

    vec![
        (
            "FrameScript",
            vec![
                ("Version", env!("CARGO_PKG_VERSION").into()),
                ("V8", framescript_engine::v8_version().into()),
            ],
        ),
        ("Processor", processor),
        ("System", system),
        ("Window GPU", display),
    ]
}

/// What takes a moment: the GPU exports are drawn with, and FFmpeg. For a thread of its own.
pub fn slowly() -> Vec<Section> {
    let export = match anti_webui::wgpu::Gpu::headless() {
        Ok(gpu) => gpu_lines(&gpu.adapter.get_info()),
        Err(e) => vec![("Adapter", format!("none: {e}"))],
    };
    let mut ffmpeg = vec![(
        "Command",
        framescript_engine::export::ffmpeg().display().to_string(),
    )];
    match Command::new(framescript_engine::export::ffmpeg())
        .arg("-version")
        .stdin(Stdio::null())
        .output()
    {
        Ok(out) => {
            let text = String::from_utf8_lossy(&out.stdout);
            let first = text.lines().next().unwrap_or_default();
            let version = first
                .strip_prefix("ffmpeg version ")
                .and_then(|v| v.split_whitespace().next())
                .unwrap_or(first);
            ffmpeg.push(("Version", version.into()));
        }
        Err(e) => ffmpeg.push(("Version", format!("can't run it: {e}"))),
    }
    if let Ok(codecs) = framescript_engine::export::available_codecs() {
        let names: Vec<_> = codecs.iter().map(|c| c.label()).collect();
        ffmpeg.push(("Encoders", names.join(", ")));
    }
    vec![("Export GPU", export), ("FFmpeg", ffmpeg)]
}

fn gpu_lines(info: &wgpu::AdapterInfo) -> Vec<(&'static str, String)> {
    let kind = match info.device_type {
        wgpu::DeviceType::DiscreteGpu => "Discrete",
        wgpu::DeviceType::IntegratedGpu => "Integrated",
        wgpu::DeviceType::VirtualGpu => "Virtual",
        wgpu::DeviceType::Cpu => "Software",
        wgpu::DeviceType::Other => "Other",
    };
    let mut lines = vec![
        ("Adapter", info.name.clone()),
        ("Kind", kind.into()),
        ("API", format!("{:?}", info.backend)),
    ];
    let driver = [info.driver.as_str(), info.driver_info.as_str()]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if !driver.is_empty() {
        lines.push(("Driver", driver));
    }
    lines
}

fn memory_total() -> Option<String> {
    let info = std::fs::read_to_string("/proc/meminfo").ok()?;
    let kib: f64 = info
        .lines()
        .find_map(|l| l.strip_prefix("MemTotal:"))?
        .split_whitespace()
        .next()?
        .parse()
        .ok()?;
    Some(format!("{:.1} GiB", kib / 1024.0 / 1024.0))
}

/// All of it as plain text, to paste into a report.
pub fn as_text(sections: &[Section]) -> String {
    let mut out = String::new();
    for (title, lines) in sections {
        out += &format!("{title}\n");
        for (name, value) in lines {
            out += &format!("  {name}: {value}\n");
        }
    }
    out
}
