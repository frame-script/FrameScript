pub mod hw_decoder;
pub mod sw_decoder;
pub(crate) mod command;
pub(crate) mod bin;

use serde::Deserialize;
use std::process::Command;

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    duration: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    duration: Option<String>,
    avg_frame_rate: Option<String>,
    r_frame_rate: Option<String>,
    nb_read_frames: Option<String>,
    nb_frames: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct FfprobeOutput {
    format: Option<FfprobeFormat>,
    streams: Option<Vec<FfprobeStream>>,
}

fn run_ffprobe(
    path: &str,
    select_streams: Option<&str>,
    entries: &str,
    count_frames: bool,
) -> Result<FfprobeOutput, String> {
    let ffprobe = bin::ffprobe_path()?;
    let mut cmd = Command::new(ffprobe);
    cmd.arg("-v")
        .arg("error")
        .arg("-print_format")
        .arg("json")
        .arg("-show_entries")
        .arg(entries);
    if count_frames {
        cmd.arg("-count_frames");
    }
    if let Some(select_streams) = select_streams {
        cmd.arg("-select_streams").arg(select_streams);
    }
    cmd.arg(path);

    let output = cmd
        .output()
        .map_err(|error| format!("failed to run ffprobe: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed: {}", stderr.trim()));
    }

    serde_json::from_slice::<FfprobeOutput>(&output.stdout)
        .map_err(|error| format!("failed to parse ffprobe json: {error}"))
}

fn parse_duration_seconds(value: Option<&str>) -> Option<f64> {
    let value = value?.trim();
    if value.is_empty() || value == "N/A" {
        return None;
    }
    let seconds = value.parse::<f64>().ok()?;
    if seconds.is_finite() && seconds > 0.0 {
        Some(seconds)
    } else {
        None
    }
}

fn parse_ratio(value: Option<&str>) -> Option<f64> {
    let value = value?.trim();
    if value.is_empty() || value == "N/A" {
        return None;
    }
    if let Some((num, den)) = value.split_once('/') {
        let num = num.trim().parse::<f64>().ok()?;
        let den = den.trim().parse::<f64>().ok()?;
        if den <= 0.0 {
            return None;
        }
        let ratio = num / den;
        if ratio.is_finite() && ratio > 0.0 {
            Some(ratio)
        } else {
            None
        }
    } else {
        let ratio = value.parse::<f64>().ok()?;
        if ratio.is_finite() && ratio > 0.0 {
            Some(ratio)
        } else {
            None
        }
    }
}

/// Return video duration in milliseconds using ffprobe metadata.
pub fn probe_video_duration_ms(path: &str) -> Result<u64, String> {
    let output = run_ffprobe(path, Some("v:0"), "format=duration:stream=duration", false)?;
    let stream_duration = output
        .streams
        .as_ref()
        .and_then(|streams| streams.first())
        .and_then(|stream| parse_duration_seconds(stream.duration.as_deref()));
    let format_duration = output
        .format
        .as_ref()
        .and_then(|format| parse_duration_seconds(format.duration.as_deref()));

    let seconds = stream_duration.or(format_duration).ok_or_else(|| "failed to read duration".to_string())?;
    Ok((seconds * 1000.0).round().max(0.0) as u64)
}

pub fn probe_video_frames(path: &str) -> Result<u64, String> {
    let output = run_ffprobe(
        path,
        Some("v:0"),
        "stream=nb_read_frames,nb_frames,duration,avg_frame_rate",
        true,
    )?;
    let stream = output
        .streams
        .as_ref()
        .and_then(|streams| streams.first())
        .ok_or_else(|| "failed to read frames".to_string())?;

    if let Some(frames) = stream
        .nb_read_frames
        .as_deref()
        .and_then(|value| value.parse::<u64>().ok())
    {
        if frames > 0 {
            return Ok(frames);
        }
    }

    if let Some(frames) = stream.nb_frames.as_deref().and_then(|value| value.parse::<u64>().ok()) {
        if frames > 0 {
            return Ok(frames);
        }
    }

    let duration = parse_duration_seconds(stream.duration.as_deref());
    let fps = parse_ratio(stream.avg_frame_rate.as_deref());
    if let (Some(duration), Some(fps)) = (duration, fps) {
        return Ok((duration * fps).round().max(0.0) as u64);
    }

    Err("failed to read frames".to_string())
}

pub fn probe_video_fps(path: &str) -> Result<f64, String> {
    let output = run_ffprobe(path, Some("v:0"), "stream=avg_frame_rate,r_frame_rate", false)?;
    let stream = output
        .streams
        .as_ref()
        .and_then(|streams| streams.first())
        .ok_or_else(|| "Not video!".to_string())?;

    let fps = parse_ratio(stream.avg_frame_rate.as_deref())
        .or_else(|| parse_ratio(stream.r_frame_rate.as_deref()))
        .ok_or_else(|| "failed to read fps".to_string())?;

    Ok(fps)
}

pub fn probe_video_dimensions(path: &str) -> Result<(u32, u32), String> {
    let output = run_ffprobe(path, Some("v:0"), "stream=width,height", false)?;
    let stream = output
        .streams
        .as_ref()
        .and_then(|streams| streams.first())
        .ok_or_else(|| "failed to read dimensions".to_string())?;

    let width = stream.width.unwrap_or(0);
    let height = stream.height.unwrap_or(0);
    if width > 0 && height > 0 {
        Ok((width, height))
    } else {
        Err("failed to read dimensions".to_string())
    }
}

/// Return audio duration in milliseconds using ffprobe metadata.
pub fn probe_audio_duration_ms(path: &str) -> Result<u64, String> {
    // Some containers report bogus global duration; prefer audio stream duration when available.
    const MAX_REASONABLE_DURATION_MS: u64 = 1000 * 60 * 60 * 24 * 7; // 7 days

    let output = run_ffprobe(path, Some("a:0"), "format=duration:stream=duration", false)?;
    let stream_duration = output
        .streams
        .as_ref()
        .and_then(|streams| streams.first())
        .and_then(|stream| parse_duration_seconds(stream.duration.as_deref()));
    let format_duration = output
        .format
        .as_ref()
        .and_then(|format| parse_duration_seconds(format.duration.as_deref()));

    for duration in [stream_duration, format_duration].into_iter().flatten() {
        let duration_ms = (duration * 1000.0).round().max(0.0) as u64;
        if duration_ms > 0 && duration_ms <= MAX_REASONABLE_DURATION_MS {
            return Ok(duration_ms);
        }
    }

    Err("failed to read audio duration".to_string())
}
