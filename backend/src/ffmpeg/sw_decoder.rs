use crate::ffmpeg::command::extract_frames_rgba;

pub fn extract_frame_sw_rgba(
    path: &str,
    target_frame: usize,
    dst_width: u32,
    dst_height: u32,
) -> Result<Vec<u8>, String> {
    let frames =
        extract_frames_rgba(path, target_frame, target_frame, dst_width, dst_height, false)?;
    if let Some(frame) = frames.into_iter().next() {
        Ok(frame)
    } else {
        Ok(generate_empty_frame(dst_width, dst_height))
    }
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
