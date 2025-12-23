use std::io::{self, Read};
use std::process::{Command, Stdio};

pub(crate) fn extract_frames_rgba(
    path: &str,
    start_frame: usize,
    end_frame: usize,
    dst_width: u32,
    dst_height: u32,
    use_hwaccel: bool,
) -> Result<Vec<Vec<u8>>, String> {
    if end_frame < start_frame {
        return Ok(Vec::new());
    }
    let frame_size = (dst_width as usize)
        .saturating_mul(dst_height as usize)
        .saturating_mul(4);
    if frame_size == 0 {
        return Err("invalid output size".to_string());
    }

    let filter = format!(
        "trim=start_frame={}:end_frame={},scale={}x{}",
        start_frame, end_frame, dst_width, dst_height
    );

    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-nostdin");
    if use_hwaccel {
        cmd.arg("-hwaccel").arg("auto");
    }
    cmd.arg("-i")
        .arg(path)
        .arg("-vf")
        .arg(filter)
        .arg("-an")
        .arg("-vsync")
        .arg("0")
        .arg("-f")
        .arg("rawvideo")
        .arg("-pix_fmt")
        .arg("rgba")
        .arg("pipe:1");

    cmd.stdout(Stdio::piped()).stderr(Stdio::inherit());

    let mut child = cmd
        .spawn()
        .map_err(|error| format!("failed to run ffmpeg: {error}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to open ffmpeg stdout".to_string())?;

    let max_frames = end_frame - start_frame + 1;
    let mut frames = Vec::new();
    let mut index = 0usize;

    loop {
        let mut frame = vec![0u8; frame_size];
        match stdout.read_exact(&mut frame) {
            Ok(()) => {
                if index < max_frames {
                    frames.push(frame);
                }
                index = index.saturating_add(1);
            }
            Err(error) => {
                if error.kind() == io::ErrorKind::UnexpectedEof {
                    break;
                }
                return Err(format!("failed to read ffmpeg output: {error}"));
            }
        }
    }

    let status = child
        .wait()
        .map_err(|error| format!("failed to wait on ffmpeg: {error}"))?;
    if !status.success() {
        return Err(format!("ffmpeg failed with status: {status}"));
    }

    Ok(frames)
}
