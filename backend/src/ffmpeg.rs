pub mod hw_decoder;
pub mod sw_decoder;

use ffmpeg_next as ffmpeg;

/// Return video duration in milliseconds using ffmpeg metadata.
pub fn probe_video_duration_ms(path: &str) -> Result<u64, String> {
    ffmpeg::init().map_err(|error| format!("ffmpeg::init failed: {}", error))?;

    let ictx = ffmpeg::format::input(path).map_err(|_| format!("failed to open input: {path}"))?;

    let duration = ictx.duration();
    if duration > 0 {
        let seconds = duration as f64 / ffmpeg::ffi::AV_TIME_BASE as f64;
        let duration_ms = (seconds * 1000.0).round().max(0.0) as u64;
        return Ok(duration_ms);
    }

    if let Some(stream) = ictx.streams().best(ffmpeg::media::Type::Video) {
        let frames = stream.frames();
        if frames > 0 {
            let rate = stream.rate();
            let fps = rate.numerator() as f64 / (rate.denominator().max(1) as f64);
            if fps > 0.0 {
                let duration_ms = ((frames as f64 / fps) * 1000.0).round().max(0.0) as u64;
                return Ok(duration_ms);
            }
        }

        let stream_duration = stream.duration();
        if stream_duration > 0 {
            let tb = stream.time_base();
            let seconds = stream_duration as f64 * tb.numerator() as f64 / tb.denominator() as f64;
            let duration_ms = (seconds * 1000.0).round().max(0.0) as u64;
            return Ok(duration_ms);
        }
    }

    Err("failed to read duration".to_string())
}
