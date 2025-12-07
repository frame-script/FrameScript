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
    pub static DECODE_HW_PIX_FORMAT: Cell<AVPixelFormat> = Cell::new(AVPixelFormat::AV_PIX_FMT_NONE);
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
    unsafe {
        let mut hw_device_ctx: *mut ffi::AVBufferRef = ptr::null_mut();

        let ret = ffi::av_hwdevice_ctx_create(
            &mut hw_device_ctx,
            device_type,
            ptr::null(),
            ptr::null_mut(),
            0,
        );
        if ret < 0 {
            return Err(format!(
                "av_hwdevice_ctx_create failed: {}",
                ffmpeg_error_string(ret)
            ));
        }

        let avctx = ctx.as_mut_ptr();

        DECODE_HW_PIX_FORMAT.set(pixel_format);
        (*avctx).get_format = Some(get_hw_format);

        (*avctx).hw_device_ctx = ffi::av_buffer_ref(hw_device_ctx);
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

pub fn extract_frame_hw_rgba(
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

    let mut scaler: Option<ScalingContext> = None;

    let mut decoded = Video::empty();
    let mut current_index = 0usize;

    for (stream, packet) in ictx.packets() {
        if stream.index() != stream_index {
            continue;
        }

        decoder
            .send_packet(&packet)
            .map_err(|error| format!("send_packet failed: {error}"))?;

        while decoder.receive_frame(&mut decoded).is_ok() {
            if current_index == target_frame {
                let rgba = hw_frame_to_rgba(
                    &mut decoded,
                    is_found_hw_decoder,
                    &mut scaler,
                    dst_width,
                    dst_height,
                )?;
                return Ok(rgba);
            }

            current_index += 1;
        }
    }

    decoder
        .send_eof()
        .map_err(|error| format!("failed to send EOF : {}", error))?;

    while decoder.receive_frame(&mut decoded).is_ok() {
        if current_index == target_frame {
            let rgba = hw_frame_to_rgba(
                &mut decoded,
                is_found_hw_decoder,
                &mut scaler,
                dst_width,
                dst_height,
            )?;
            return Ok(rgba);
        }
        current_index += 1;
    }

    Ok(generate_empty_frame(dst_width, dst_height))
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
