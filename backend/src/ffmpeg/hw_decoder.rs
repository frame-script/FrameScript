use crate::decoder::generate_empty_frame;
use crate::ffmpeg::command::extract_frames_rgba;

pub fn extract_frame_window_hw_rgba(
    path: &str,
    start_frame: usize,
    end_frame: usize,
    dst_width: u32,
    dst_height: u32,
) -> Result<Vec<(usize, Vec<u8>)>, String> {
    let end_exclusive = end_frame.saturating_add(1);
    let frames = match extract_frames_rgba(
        path,
        start_frame,
        end_exclusive,
        dst_width,
        dst_height,
        true,
    ) {
        Ok(frames) => frames,
        Err(hw_err) => extract_frames_rgba(
            path,
            start_frame,
            end_exclusive,
            dst_width,
            dst_height,
            false,
        )
        .map_err(|sw_err| format!("hwaccel failed: {hw_err}; software failed: {sw_err}"))?,
    };

    if frames.is_empty() {
        return Ok(vec![(
            start_frame,
            generate_empty_frame(dst_width, dst_height),
        )]);
    }

    let mut results = Vec::with_capacity(frames.len());
    for (idx, frame) in frames.into_iter().enumerate() {
        results.push((start_frame + idx, frame));
    }

    Ok(results)
}

pub fn extract_frame_hw_rgba(
    path: &str,
    target_frame: usize,
    dst_width: u32,
    dst_height: u32,
) -> Result<Vec<u8>, String> {
    let frames =
        extract_frame_window_hw_rgba(path, target_frame, target_frame + 1, dst_width, dst_height)?;
    if let Some((_, data)) = frames.into_iter().next() {
        Ok(data)
    } else {
        Ok(generate_empty_frame(dst_width, dst_height))
    }
}
