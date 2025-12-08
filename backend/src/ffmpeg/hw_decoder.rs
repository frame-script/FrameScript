use ffmpeg_next as ffmpeg;
use ffmpeg_next::codec::Context;

use ffmpeg::format::Pixel;
use ffmpeg::software::scaling::{context::Context as ScalingContext, flag::Flags};
use ffmpeg::util::frame::video::Video;
use ffmpeg_sys_next::{AVHWDeviceType, AVPixelFormat};
use tracing::info;

use std::cell::Cell;
use std::ffi::CStr;
use std::ptr;
use std::sync::LazyLock;

use ffmpeg::ffi;

use crate::util::AtomicCell;
use crate::util::macros::once;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy)]
struct HWDecoder {
    pub device_type: AVHWDeviceType,
    pub pixel_format: AVPixelFormat,
}

static HW_DECODERS: &[HWDecoder] = &[
    // NVIDIA
    HWDecoder {
        device_type: AVHWDeviceType::AV_HWDEVICE_TYPE_CUDA,
        pixel_format: AVPixelFormat::AV_PIX_FMT_CUDA,
    },
    // Intel
    HWDecoder {
        device_type: AVHWDeviceType::AV_HWDEVICE_TYPE_QSV,
        pixel_format: AVPixelFormat::AV_PIX_FMT_QSV,
    },
    // Linux: AMD or Intel
    HWDecoder {
        device_type: AVHWDeviceType::AV_HWDEVICE_TYPE_VAAPI,
        pixel_format: AVPixelFormat::AV_PIX_FMT_VAAPI,
    },
    // Windows: DirectX12
    HWDecoder {
        device_type: AVHWDeviceType::AV_HWDEVICE_TYPE_D3D12VA,
        pixel_format: AVPixelFormat::AV_PIX_FMT_D3D12,
    },
    // Windows: DirectX11
    HWDecoder {
        device_type: AVHWDeviceType::AV_HWDEVICE_TYPE_D3D11VA,
        pixel_format: AVPixelFormat::AV_PIX_FMT_D3D11,
    },
    // MacOS
    HWDecoder {
        device_type: AVHWDeviceType::AV_HWDEVICE_TYPE_VIDEOTOOLBOX,
        pixel_format: AVPixelFormat::AV_PIX_FMT_VIDEOTOOLBOX,
    },
];

thread_local! {
    static DECODE_HW_PIX_FORMAT: Cell<AVPixelFormat> = Cell::new(AVPixelFormat::AV_PIX_FMT_NONE);
}

#[derive(Debug)]
struct SharedHwDevice {
    ptr: *mut ffi::AVBufferRef,
}

unsafe impl Send for SharedHwDevice {}
unsafe impl Sync for SharedHwDevice {}

impl SharedHwDevice {
    fn new(device_type: AVHWDeviceType) -> Result<Self, String> {
        let mut raw: *mut ffi::AVBufferRef = ptr::null_mut();

        let ret = unsafe {
            ffi::av_hwdevice_ctx_create(
                &mut raw,
                device_type,
                ptr::null(),
                ptr::null_mut(),
                0,
            )
        };

        if ret < 0 {
            return Err(ffmpeg_error_string(ret));
        }

        Ok(Self { ptr: raw })
    }
}

impl Drop for SharedHwDevice {
    fn drop(&mut self) {
        unsafe {
            ffi::av_buffer_unref(&mut self.ptr);
        }
    }
}

static HW_DEVICE_REF: LazyLock<Mutex<Option<Arc<SharedHwDevice>>>> =
    LazyLock::new(|| Mutex::new(None));

fn get_or_init_hw_device(device_type: AVHWDeviceType) -> Option<Arc<SharedHwDevice>> {
    let mut guard = HW_DEVICE_REF.lock().unwrap();
    if guard.is_none() {
        if let Ok(device) = SharedHwDevice::new(device_type) {
            *guard = Some(Arc::new(device));
        }
    }
    guard.clone()
}

unsafe extern "C" fn get_hw_format(
    _ctx: *mut ffi::AVCodecContext,
    pix_fmts: *const ffi::AVPixelFormat,
) -> ffi::AVPixelFormat {
    unsafe {
        let goal_pixel_format = DECODE_HW_PIX_FORMAT.get();

        let mut p = pix_fmts;
        while *p != AVPixelFormat::AV_PIX_FMT_NONE {
            if *p == goal_pixel_format {
                return *p;
            }
            p = p.add(1);
        }

        eprintln!(
            "[HW] Wanted HW pixel format {:?}, but not found. Fallback to first.",
            goal_pixel_format as i32
        );

        *pix_fmts
    }
}

fn init_hw_device(
    ctx: &mut Context,
    device_type: AVHWDeviceType,
    pixel_format: AVPixelFormat,
) -> Result<(), String> {
    let shared = get_or_init_hw_device(device_type)
        .ok_or_else(|| "failed to create shared hw device context".to_string())?;

    unsafe {
        let avctx = ctx.as_mut_ptr();

        DECODE_HW_PIX_FORMAT.set(pixel_format);
        (*avctx).get_format = Some(get_hw_format);

        // av_buffer_ref で参照カウントを増やす。shared は静的に保持されているため GPU メモリは再利用される。
        (*avctx).hw_device_ctx = ffi::av_buffer_ref(shared.ptr);
        if (*avctx).hw_device_ctx.is_null() {
            return Err(String::from("av_buffer_ref(hw_device_ctx) failed"));
        }
    }

    Ok(())
}

fn ffmpeg_error_string(err: i32) -> String {
    unsafe {
        let mut buf = [0i8; 128];
        let ptr = buf.as_mut_ptr();
        let ret = ffi::av_strerror(err, ptr, buf.len());
        if ret < 0 {
            format!("ffmpeg error {}", err)
        } else {
            CStr::from_ptr(ptr).to_string_lossy().into_owned()
        }
    }
}

pub fn extract_frame_window_hw_rgba(
    path: &str,
    start_frame: usize,
    end_frame: usize,
    dst_width: u32,
    dst_height: u32,
) -> Result<Vec<(usize, Vec<u8>)>, String> {
    ffmpeg::init().map_err(|error| format!("ffmpeg::init failed: {}", error))?;

    let mut ictx =
        ffmpeg::format::input(&path).map_err(|_| format!("failed to open input: {path}"))?;

    let Some(input_stream) = ictx.streams().best(ffmpeg::media::Type::Video) else {
        return Err("no video stream found".to_string());
    };
    let stream_index = input_stream.index();

    let mut ctx = ffmpeg::codec::context::Context::from_parameters(input_stream.parameters())
        .map_err(|error| format!("failed to create codec context: {}", error))?;

    static HW_DECODER: LazyLock<AtomicCell<Option<HWDecoder>>> =
        LazyLock::new(|| AtomicCell::new(None));

    let mut is_found_hw_decoder = false;

    match HW_DECODER.get().is_some() {
        true => {
            let decoder = HW_DECODER.get().unwrap();

            if decoder.device_type != AVHWDeviceType::AV_HWDEVICE_TYPE_NONE {
                init_hw_device(&mut ctx, decoder.device_type, decoder.pixel_format)
                    .map_err(|error| format!("failed to second init_hw_decide() : {}", error))?;
                is_found_hw_decoder = true;
            }
        }
        false => {
            for &hw_decoder in HW_DECODERS.iter() {
                let result =
                    init_hw_device(&mut ctx, hw_decoder.device_type, hw_decoder.pixel_format);

                match result {
                    Ok(_) => {
                        once!(info!("HW Decoder found : {:?}", hw_decoder));
                        HW_DECODER.set(Some(hw_decoder));
                        is_found_hw_decoder = true;
                        break;
                    }
                    Err(_) => continue,
                }
            }

            if !is_found_hw_decoder {
                // NOT FOUND HW DECODER :(
                HW_DECODER.set(Some(HWDecoder {
                    device_type: AVHWDeviceType::AV_HWDEVICE_TYPE_NONE,
                    pixel_format: AVPixelFormat::AV_PIX_FMT_NONE,
                }));
            }
        }
    }

    if !is_found_hw_decoder {
        once!(info!("HW Decoder is not found :("));
    }

    let mut decoder = ctx
        .decoder()
        .video()
        .map_err(|error| format!("not a video stream: {}", error))?;

    // try random access
    let time_base = input_stream.time_base();
    let fps = input_stream.rate();
    let fps_num = fps.numerator() as i64;
    let fps_den = fps.denominator() as i64;
    let tb_num = time_base.numerator() as i64;
    let tb_den = time_base.denominator() as i64;
    // pts ≈ (frame / fps) / time_base = frame * (tb_den / (tb_num * fps))
    let seek_pts = {
        let fps_f = (fps_num as f64).max(1.0) / (fps_den as f64).max(1.0);
        let tb_f = (tb_num as f64).max(1.0) / (tb_den as f64).max(1.0);
        let seconds = start_frame as f64 / fps_f.max(1e-6);
        (seconds / tb_f).round() as i64
    };

    unsafe {
        let ret = ffi::av_seek_frame(
            ictx.as_mut_ptr(),
            stream_index as i32,
            seek_pts,
            ffi::AVSEEK_FLAG_BACKWARD,
        );
        if ret < 0 {
            info!("av_seek_frame failed (fallback to start decode): {}", ffmpeg_error_string(ret));
        } else {
            decoder.flush();
        }
    }

    let mut scaler: Option<ScalingContext> = None;

    let mut decoded = Video::empty();
    let mut results: Vec<(usize, Vec<u8>)> = Vec::new();

    let mut fallback_index = start_frame;
    for (stream, packet) in ictx.packets() {
        if stream.index() != stream_index {
            continue;
        }

        decoder
            .send_packet(&packet)
            .map_err(|error| format!("send_packet failed: {error}"))?;

        while decoder.receive_frame(&mut decoded).is_ok() {
            let frame_index = decoded.timestamp().map(|ts| {
                let ts_f = ts as f64 * tb_num as f64 / tb_den as f64;
                let fps_f = fps_num as f64 / fps_den as f64;
                (ts_f * fps_f).round().max(0.0) as usize
            }).unwrap_or_else(|| {
                let idx = fallback_index;
                fallback_index = fallback_index.saturating_add(1);
                idx
            });

            if frame_index > end_frame {
                break;
            }

            if frame_index >= start_frame && frame_index <= end_frame {
                let rgba = hw_frame_to_rgba(
                    &mut decoded,
                    is_found_hw_decoder,
                    &mut scaler,
                    dst_width,
                    dst_height,
                )?;
                results.push((frame_index, rgba));
            }
        }

        if let Some((last_idx, _)) = results.last() {
            if *last_idx >= end_frame {
                break;
            }
        }
    }

    decoder
        .send_eof()
        .map_err(|error| format!("failed to send EOF : {}", error))?;

    while decoder.receive_frame(&mut decoded).is_ok() {
        let frame_index = decoded.timestamp().map(|ts| {
            let ts_f = ts as f64 * tb_num as f64 / tb_den as f64;
            let fps_f = fps_num as f64 / fps_den as f64;
            (ts_f * fps_f).round().max(0.0) as usize
        }).unwrap_or_else(|| {
            let idx = fallback_index;
            fallback_index = fallback_index.saturating_add(1);
            idx
        });

        if frame_index > end_frame {
            break;
        }

        if frame_index >= start_frame && frame_index <= end_frame {
            let rgba = hw_frame_to_rgba(
                &mut decoded,
                is_found_hw_decoder,
                &mut scaler,
                dst_width,
                dst_height,
            )?;
            results.push((frame_index, rgba));
        }

        if let Some((last_idx, _)) = results.last() {
            if *last_idx >= end_frame {
                break;
            }
        }
    }

    if results.is_empty() {
        results.push((start_frame, generate_empty_frame(dst_width, dst_height)));
    }

    Ok(results)
}

/// 単一フレーム用の薄いラッパー。互換性維持のために提供。
pub fn extract_frame_hw_rgba(
    path: &str,
    target_frame: usize,
    dst_width: u32,
    dst_height: u32,
) -> Result<Vec<u8>, String> {
    let frames = extract_frame_window_hw_rgba(path, target_frame, target_frame, dst_width, dst_height)?;
    if let Some((_, data)) = frames.into_iter().next() {
        Ok(data)
    } else {
        Ok(generate_empty_frame(dst_width, dst_height))
    }
}

fn hw_frame_to_rgba(
    hw_or_sw_frame: &mut Video,
    is_hw_decode: bool,
    scaler: &mut Option<ScalingContext>,
    dst_w: u32,
    dst_h: u32,
) -> Result<Vec<u8>, String> {
    let src_frame: &Video = if is_hw_decode {
        // HW => SW
        let mut sw_frame = Video::empty();
        unsafe {
            let src = hw_or_sw_frame.as_ptr() as *const ffi::AVFrame;
            let dst = sw_frame.as_mut_ptr() as *mut ffi::AVFrame;

            let ret = ffi::av_hwframe_transfer_data(dst, src, 0);
            if ret < 0 {
                return Err(format!(
                    "av_hwframe_transfer_data failed: {}",
                    ffmpeg_error_string(ret)
                ));
            }
        }
        *hw_or_sw_frame = sw_frame;

        &hw_or_sw_frame
    } else {
        hw_or_sw_frame
    };

    if scaler.is_none() {
        *scaler = Some(
            ScalingContext::get(
                src_frame.format(),
                src_frame.width(),
                src_frame.height(),
                Pixel::RGBA,
                dst_w,
                dst_h,
                Flags::BILINEAR,
            )
            .map_err(|error| format!("failed to create scaler to RGBA: {}", error))?,
        );
    }

    let scaler = scaler.as_mut().unwrap();

    // into RGBA
    let mut rgba_frame = Video::empty();
    scaler
        .run(src_frame, &mut rgba_frame)
        .map_err(|error| format!("failed to translate frame : {}", error))?;

    // copy to RGBA
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

            let r = 0;
            let g = 0;
            let b = 0;
            let a = 255u8;

            buf[idx] = r;
            buf[idx + 1] = g;
            buf[idx + 2] = b;
            buf[idx + 3] = a;
        }
    }

    buf
}
