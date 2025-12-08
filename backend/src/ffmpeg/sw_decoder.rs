use ffmpeg::codec::threading::Type as ThreadType;
use ffmpeg::format::Pixel;
use ffmpeg::software::scaling::{context::Context as ScalingContext, flag::Flags};
use ffmpeg::util::frame::video::Video;
use ffmpeg_next as ffmpeg;
use ffmpeg_next::codec::Context;
use ffmpeg_next::threading::Config;

pub fn extract_frame_sw_rgba(
    path: &str,
    target_frame: usize,
    dst_width: u32,
    dst_height: u32,
) -> Result<Vec<u8>, String> {
    ffmpeg::init().map_err(|error| format!("ffmpeg::init failed: {}", error))?;

    let mut ictx =
        ffmpeg::format::input(&path).map_err(|_| format!("failed to open input: {path}"))?;

    let Some(input_stream) = ictx.streams().best(ffmpeg::media::Type::Video) else {
        return Err("no video stream found".to_string());
    };
    let stream_index = input_stream.index();

    let mut ctx = Context::from_parameters(input_stream.parameters())
        .map_err(|error| format!("failed to create codec context: {}", error))?;
    ctx.set_threading(Config {
        kind: ThreadType::Frame,
        count: 16,
    });

    let mut decoder = ctx
        .decoder()
        .video()
        .map_err(|error| format!("not a video stream: {}", error))?;

    let time_base = input_stream.time_base();
    let fps = input_stream.rate();
    let fps_num = fps.numerator() as f64;
    let fps_den = fps.denominator() as f64;
    let tb_num = time_base.numerator() as f64;
    let tb_den = time_base.denominator() as f64;

    let mut scaler: Option<ScalingContext> = None;
    let mut decoded = Video::empty();
    let mut fallback_index = target_frame;

    for (stream, packet) in ictx.packets() {
        if stream.index() != stream_index {
            continue;
        }

        decoder
            .send_packet(&packet)
            .map_err(|error| format!("send_packet failed: {error}"))?;

        while decoder.receive_frame(&mut decoded).is_ok() {
            let frame_index = decoded
                .timestamp()
                .map(|ts| {
                    let ts_f = ts as f64 * tb_num / tb_den;
                    let fps_f = if fps_den > 0.0 {
                        fps_num / fps_den
                    } else {
                        0.0
                    };
                    (ts_f * fps_f).round().max(0.0) as usize
                })
                .unwrap_or_else(|| {
                    let idx = fallback_index;
                    fallback_index = fallback_index.saturating_add(1);
                    idx
                });

            if frame_index == target_frame {
                let rgba = sw_frame_to_rgba(&mut decoded, &mut scaler, dst_width, dst_height)?;
                return Ok(rgba);
            }

            if frame_index > target_frame.saturating_add(8) {
                break;
            }
        }
    }

    decoder
        .send_eof()
        .map_err(|error| format!("failed to send EOF : {}", error))?;

    while decoder.receive_frame(&mut decoded).is_ok() {
        let frame_index = decoded
            .timestamp()
            .map(|ts| {
                let ts_f = ts as f64 * tb_num / tb_den;
                let fps_f = if fps_den > 0.0 {
                    fps_num / fps_den
                } else {
                    0.0
                };
                (ts_f * fps_f).round().max(0.0) as usize
            })
            .unwrap_or_else(|| {
                let idx = fallback_index;
                fallback_index = fallback_index.saturating_add(1);
                idx
            });

        if frame_index == target_frame {
            let rgba = sw_frame_to_rgba(&mut decoded, &mut scaler, dst_width, dst_height)?;
            return Ok(rgba);
        }
    }

    Ok(generate_empty_frame(dst_width, dst_height))
}

fn sw_frame_to_rgba(
    src_frame: &mut Video,
    scaler: &mut Option<ScalingContext>,
    dst_w: u32,
    dst_h: u32,
) -> Result<Vec<u8>, String> {
    if scaler.is_none() {
        *scaler = Some(
            ScalingContext::get(
                src_frame.format(),
                src_frame.width(),
                src_frame.height(),
                Pixel::RGBA,
                dst_w,
                dst_h,
                Flags::FAST_BILINEAR,
            )
            .map_err(|error| format!("failed to create scaler to RGBA: {}", error))?,
        );
    }

    let scaler = scaler.as_mut().unwrap();

    let mut rgba_frame = Video::empty();
    scaler
        .run(src_frame, &mut rgba_frame)
        .map_err(|error| format!("failed to translate frame : {}", error))?;

    let w = dst_w as usize;
    let h = dst_h as usize;
    let mut buf = vec![0u8; w * h * 4];

    let data = rgba_frame.data(0);
    let linesize = rgba_frame.stride(0) as usize;

    for y in 0..h {
        let src_start = y * linesize;
        let src_end = src_start + w * 4;
        let dst_start = y * w * 4;
        let dst_end = dst_start + w * 4;
        buf[dst_start..dst_end].copy_from_slice(&data[src_start..src_end]);
    }

    Ok(buf)
}

fn generate_empty_frame(width: u32, height: u32) -> Vec<u8> {
    let mut buf = vec![0u8; (width * height * 4) as usize];
    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;
            buf[idx + 3] = 255u8;
        }
    }
    buf
}
