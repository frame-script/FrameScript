use std::{
    error::Error,
    collections::BTreeMap,
    io,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Mutex, OnceLock},
};

use serde::Deserialize;
use tokio::{
    fs,
    io::AsyncWriteExt,
    process::{Child, ChildStdin, Command as TokioCommand},
};

static FFMPEG_PATH: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn read_env_path(env_var: &str) -> Option<String> {
    let value = std::env::var(env_var).ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn resolve_ffmpeg_path() -> Result<String, Box<dyn Error>> {
    let lock = FFMPEG_PATH.get_or_init(|| Mutex::new(None));
    let mut cached = lock.lock().unwrap();
    if let Some(path) = cached.as_ref() {
        return Ok(path.clone());
    }

    match std::process::Command::new("ffmpeg")
        .arg("-version")
        .output()
    {
        Ok(_) => {
            let path = "ffmpeg".to_string();
            *cached = Some(path.clone());
            Ok(path)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            if let Some(path) = read_env_path("FRAMESCRIPT_FFMPEG_PATH") {
                *cached = Some(path.clone());
                Ok(path)
            } else {
                Err("ffmpeg not found on PATH and FRAMESCRIPT_FFMPEG_PATH is not set".into())
            }
        }
        Err(error) => Err(format!("failed to run ffmpeg: {error}").into()),
    }
}

pub struct SegmentWriter {
    child: Child,
    stdin: ChildStdin,
}

impl SegmentWriter {
    pub async fn new(
        output_path: &str,
        width: u32,
        height: u32,
        fps: f64,
        crf: u32,
        encode: &str,
        preset: Option<&str>,
        gop: Option<u32>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let vcodec = match encode {
            "H264" => "libx264",
            "H265" => "libx265",
            _ => return Err(format!("Unsupported encode: {}", encode).into()),
        };

        let preset = preset.unwrap_or("medium");

        let ffmpeg = resolve_ffmpeg_path()?;
        let mut cmd = TokioCommand::new(ffmpeg);
        cmd.arg("-y")
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-f")
            .arg("image2pipe")
            .arg("-vcodec")
            .arg("png")
            .arg("-framerate")
            .arg(format!("{}", fps))
            .arg("-s")
            .arg(format!("{}x{}", width, height))
            .arg("-i")
            .arg("pipe:0")
            .arg("-r")
            .arg(format!("{}", fps))
            .arg("-c:v")
            .arg(vcodec)
            .arg("-preset")
            .arg(preset)
            .arg("-crf")
            .arg(crf.to_string())
            .arg("-pix_fmt")
            .arg("yuv420p")
            .arg("-movflags")
            .arg("+faststart");

        if let Some(g) = gop {
            cmd.arg("-g")
                .arg(g.to_string())
                .arg("-keyint_min")
                .arg(g.to_string())
                .arg("-sc_threshold")
                .arg("0");
        }

        cmd.arg(output_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit());

        let mut child = cmd.spawn().map_err(|e| {
            format!(
                "Failed to spawn ffmpeg. Is ffmpeg installed and on PATH? error={}",
                e
            )
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Failed to open ffmpeg stdin".to_string())?;

        Ok(Self { child, stdin })
    }

    pub async fn write_png_frame(&mut self, png: &[u8]) -> Result<(), Box<dyn Error>> {
        self.stdin.write_all(png).await?;
        Ok(())
    }

    pub async fn finish(mut self) -> Result<(), Box<dyn Error>> {
        self.stdin.shutdown().await?;
        drop(self.stdin);

        let status = self.child.wait().await?;
        if !status.success() {
            return Err(format!("ffmpeg exited with status: {}", status).into());
        }
        Ok(())
    }
}

fn escape_concat_path(p: &str) -> String {
    p.replace('\'', r"'\''")
}

fn normalize_concat_path(path: &str) -> String {
    if cfg!(windows) {
        let mut normalized = path.to_string();
        if let Some(rest) = normalized.strip_prefix(r"\\?\UNC\") {
            normalized = format!(r"\\{}", rest);
        } else if let Some(rest) = normalized.strip_prefix(r"\\?\") {
            normalized = rest.to_string();
        }
        normalized.replace('\\', "/")
    } else {
        path.to_string()
    }
}

pub async fn concat_segments_mp4(
    segments: Vec<PathBuf>,
    output_path: &Path,
) -> Result<(), Box<dyn Error>> {
    if segments.is_empty() {
        return Err("No segment files.".into());
    }

    let list_path = output_path.with_extension("segments.txt");
    let list_dir = list_path.parent().unwrap_or_else(|| Path::new("."));
    let list_dir_abs = tokio::task::spawn_blocking({
        let list_dir = list_dir.to_path_buf();
        move || std::fs::canonicalize(&list_dir).unwrap_or(list_dir)
    })
    .await?;

    let mut lines = String::new();
    for seg in segments {
        let abs_path = tokio::task::spawn_blocking(move || std::fs::canonicalize(seg))
            .await??;
        let rel_path = match abs_path.strip_prefix(&list_dir_abs) {
            Ok(rel) => rel.to_path_buf(),
            Err(_) => abs_path,
        };
        let abs = normalize_concat_path(rel_path.to_string_lossy().as_ref());

        lines.push_str("file '");
        lines.push_str(&escape_concat_path(&abs));
        lines.push_str("'\n");
    }

    fs::write(&list_path, lines).await?;

    let ffmpeg = resolve_ffmpeg_path()?;
    let status = TokioCommand::new(ffmpeg)
        .arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-f")
        .arg("concat")
        .arg("-safe")
        .arg("0")
        .arg("-i")
        .arg(&list_path)
        .arg("-c")
        .arg("copy")
        .arg("-movflags")
        .arg("+faststart")
        .arg(output_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .status()
        .await?;

    if !status.success() {
        return Err(format!("ffmpeg concat failed: {}", status).into());
    }

    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum AudioSourceResolved {
    Video { path: String },
    Sound { path: String },
}

#[derive(Debug, Clone, Deserialize)]
pub struct AudioSegmentResolved {
    pub id: String,
    pub source: AudioSourceResolved,
    #[serde(rename = "projectStartFrame")]
    pub project_start_frame: i64,
    #[serde(rename = "sourceStartFrame")]
    pub source_start_frame: i64,
    #[serde(rename = "durationFrames")]
    pub duration_frames: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AudioPlanResolved {
    pub fps: f64,
    pub segments: Vec<AudioSegmentResolved>,
}

pub async fn mux_audio_plan_into_mp4(
    input_video: &Path,
    output_video: &Path,
    plan: &AudioPlanResolved,
    total_frames: usize,
    fps: f64,
) -> Result<(), Box<dyn Error>> {
    if plan.segments.is_empty() {
        // nothing to mux
        return Ok(());
    }

    let fps = if fps.is_finite() && fps > 0.0 { fps } else { plan.fps };
    let fps = if fps.is_finite() && fps > 0.0 { fps } else { 60.0 };
    let duration_sec = (total_frames as f64) / fps;

    let mut sources: BTreeMap<String, usize> = BTreeMap::new();
    let mut next_input_index: usize = 1; // input #0 is video
    for seg in &plan.segments {
        let path = match &seg.source {
            AudioSourceResolved::Video { path } => path,
            AudioSourceResolved::Sound { path } => path,
        };
        if !sources.contains_key(path) {
            sources.insert(path.clone(), next_input_index);
            next_input_index += 1;
        }
    }

    let ffmpeg = resolve_ffmpeg_path()?;
    let mut cmd = TokioCommand::new(ffmpeg);
    cmd.arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-i")
        .arg(input_video);

    let mut ordered_sources: Vec<(String, usize)> = sources.into_iter().collect();
    ordered_sources.sort_by_key(|(_, idx)| *idx);
    for (path, _) in &ordered_sources {
        cmd.arg("-i").arg(path);
    }

    let mut filter_parts: Vec<String> = Vec::new();

    let fmt_f = |value: f64| format!("{:.6}", value.max(0.0));

    // Base silent bed so output audio always starts at 0 and has deterministic duration.
    filter_parts.push(format!(
        "anullsrc=r=48000:cl=stereo:d={}[base]",
        fmt_f(duration_sec)
    ));

    let mut segment_labels: Vec<String> = Vec::new();

    for seg in plan.segments.iter() {
        let n = segment_labels.len();
        let src_path = match &seg.source {
            AudioSourceResolved::Video { path } => path,
            AudioSourceResolved::Sound { path } => path,
        };
        let Some(&input_idx) = ordered_sources
            .iter()
            .find(|(p, _)| p == src_path)
            .map(|(_, idx)| idx)
        else {
            continue;
        };

        let project_start_frame = seg.project_start_frame.max(0) as f64;
        let source_start_frame = seg.source_start_frame.max(0) as f64;
        let duration_frames = seg.duration_frames.max(0) as f64;
        if duration_frames <= 0.0 {
            continue;
        }

        let start_sec = source_start_frame / fps;
        let dur_sec = duration_frames / fps;
        let delay_ms = ((project_start_frame / fps) * 1000.0).round().max(0.0) as i64;

        filter_parts.push(format!(
            "[{input_idx}:a]atrim=start={}:duration={},asetpts=PTS-STARTPTS,aresample=48000,adelay={delay_ms}:all=1[a{n}]",
            fmt_f(start_sec),
            fmt_f(dur_sec),
        ));

        segment_labels.push(format!("[a{n}]"));
    }

    if segment_labels.is_empty() {
        return Ok(());
    }

    let seg_count = segment_labels.len();
    let mix_inputs = std::iter::once("[base]".to_string())
        .chain(segment_labels.iter().cloned())
        .collect::<String>();

    let total_inputs = 1 + seg_count;
    filter_parts.push(format!(
        "{mix_inputs}amix=inputs={total_inputs}:duration=first:normalize=0,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aout]"
    ));

    let filter_complex = filter_parts.join(";");

    cmd.arg("-filter_complex")
        .arg(filter_complex)
        .arg("-map")
        .arg("0:v:0")
        .arg("-map")
        .arg("[aout]")
        .arg("-c:v")
        .arg("copy")
        .arg("-c:a")
        .arg("aac")
        .arg("-b:a")
        .arg("192k")
        .arg("-shortest")
        .arg("-avoid_negative_ts")
        .arg("make_zero")
        .arg("-movflags")
        .arg("+faststart")
        .arg(output_video)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit());

    let status = cmd.status().await?;
    if !status.success() {
        return Err(format!("ffmpeg audio mux failed: {}", status).into());
    }

    Ok(())
}
