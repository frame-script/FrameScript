pub mod ffmpeg;

use std::time::{Duration, Instant};

use chromiumoxide::{
    Browser, Handler, Page, cdp::browser_protocol::page::CaptureScreenshotFormat,
    handler::viewport::Viewport, page::ScreenshotParams,
};
use futures::{StreamExt, stream::FuturesUnordered};

use chromiumoxide::browser::BrowserConfig;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use tempfile::TempDir;

use crate::ffmpeg::{AudioPlanResolved, SegmentWriter, mux_audio_plan_into_mp4};

#[derive(Serialize)]
struct ProgressPayload {
    completed: usize,
    total: usize,
}

#[derive(Deserialize)]
struct CancelResponse {
    canceled: bool,
}

static CHROMIUM_EXECUTABLE: OnceLock<Option<PathBuf>> = OnceLock::new();

fn parse_bool_token(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

fn resolve_chromium_executable() -> Option<PathBuf> {
    CHROMIUM_EXECUTABLE
        .get_or_init(|| {
            let path = std::env::var("FRAMESCRIPT_CHROMIUM_PATH")
                .or_else(|_| std::env::var("PUPPETEER_EXECUTABLE_PATH"))
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .map(PathBuf::from);

            if let Some(path) = path {
                if path.is_file() {
                    return Some(path);
                }
            }
            None
        })
        .clone()
}

async fn spawn_browser_instance(
    profile_id: usize,
    width: u32,
    height: u32,
) -> Result<(Browser, Handler), Box<dyn std::error::Error>> {
    // 一時ディレクトリをブラウザプロファイルとして使う
    let tmp = TempDir::new()?; // ライフタイム管理は適宜
    let user_data_dir: PathBuf = tmp.path().join(format!("profile-{}", profile_id));

    let mut builder = BrowserConfig::builder()
        .new_headless_mode()
        .viewport(Viewport {
            width,
            height,
            device_scale_factor: None,
            emulating_mobile: false,
            is_landscape: false,
            has_touch: false,
        })
        //.arg("--use-angle=swiftshader")
        .request_timeout(Duration::from_hours(24))
        .user_data_dir(user_data_dir); // ★ インスタンスごとに別のディレクトリ

    if let Some(path) = resolve_chromium_executable() {
        builder = builder.chrome_executable(path);
    }

    let config = builder.build()?;

    let (browser, handler) = Browser::launch(config).await?;
    Ok((browser, handler))
}

async fn wait_for_next_frame(page: &Page) {
    let script = r#"
        (async () => {
          await new Promise(resolve => {
            requestAnimationFrame(() => {
              requestAnimationFrame(resolve);
            });
          });
        })()
    "#;
    page.evaluate(script).await.unwrap();
}

async fn wait_for_frame_api(page: &Page) {
    let script = r#"
        (async () => {
          const start = Date.now();
          while (true) {
            const api = window.__frameScript;
            if (api && typeof api.setFrame === "function") return true;
            if (Date.now() - start > 15000) {
              throw new Error("frameScript setFrame not available");
            }
            await new Promise(resolve => {
              requestAnimationFrame(() => {
                requestAnimationFrame(resolve);
              });
            });
          }
        })()
    "#;
    page.evaluate(script).await.unwrap();
}

async fn wait_for_animation_ready(page: &Page) {
    let script = r#"
        (async () => {
          const api = window.__frameScript;
          if (api && typeof api.waitAnimationsReady === "function") {
            await api.waitAnimationsReady();
          }
        })()
    "#;
    page.evaluate(script).await.unwrap();
}

async fn wait_for_draw_text_ready(page: &Page) {
    let script = r#"
        (async () => {
          const api = window.__frameScript;
          if (api && typeof api.waitDrawTextReady === "function") {
            await api.waitDrawTextReady();
          }
        })()
    "#;
    page.evaluate(script).await.unwrap();
}

async fn wait_for_images_ready(page: &Page) {
    let script = r#"
        (async () => {
          const api = window.__frameScript;
          if (api && typeof api.waitImagesReady === "function") {
            await api.waitImagesReady();
          }
        })()
    "#;
    page.evaluate(script).await.unwrap();
}

async fn wait_for_webgl_ready(page: &Page) {
    let script = r#"
        (async () => {
          const api = window.__frameScript;
          if (api && typeof api.waitWebGLReady === "function") {
            await api.waitWebGLReady();
          }
        })()
    "#;
    page.evaluate(script).await.unwrap();
}

async fn wait_for_webgl_frame(page: &Page, frame: usize) {
    let script = format!(
        r#"
        (async () => {{
          const api = window.__frameScript;
          if (api && typeof api.waitWebGLFrame === "function") {{
            try {{
              await api.waitWebGLFrame({});
            }} catch (_e) {{
              // ignore
            }}
          }}
        }})()
    "#,
        frame
    );
    page.evaluate(script).await.unwrap();
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args().collect::<Vec<String>>();

    if args.len() < 2 {
        return Err("Invalid command.".into());
    }

    let splited = args[1].split(":").collect::<Vec<_>>();

    if splited.len() != 7 && splited.len() != 9 {
        return Err("Invalid command(split).".into());
    }

    let width = splited[0].parse::<u32>()?;
    let height = splited[1].parse::<u32>()?;
    let fps = splited[2].parse::<f64>()?;
    let total_frames = splited[3].parse::<usize>()?;
    let workers = splited[4].parse::<usize>()?;
    let encode = splited[5].to_string();
    let preset = splited[6].to_string();
    let ffmpeg_threads = splited
        .get(7)
        .and_then(|raw| raw.parse::<u32>().ok())
        .map(|value| value.max(1))
        .or(Some(1));
    let ffmpeg_low_memory = splited
        .get(8)
        .and_then(|raw| parse_bool_token(raw))
        .unwrap_or(true);

    let worker_count = workers.max(1);
    let base_chunk = total_frames / worker_count;
    let remainder = total_frames % worker_count;
    let progress_url = std::env::var("RENDER_PROGRESS_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:3000/render_progress".to_string());
    let progress_client = Client::new();
    let completed = Arc::new(AtomicUsize::new(0));
    let total_frames_usize = total_frames;

    let cancel_url = std::env::var("RENDER_CANCEL_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:3000/is_canceled".to_string());
    let is_canceled = Arc::new(AtomicBool::new(false));
    let is_canceled_clone = is_canceled.clone();
    tokio::spawn(async move {
        loop {
            let client = Client::new();
            let is_canceled = match client.get(&cancel_url).send().await {
                Ok(resp) => match resp.json::<CancelResponse>().await {
                    Ok(body) => body.canceled,
                    Err(_) => false,
                },
                Err(_) => false,
            };

            if is_canceled {
                is_canceled_clone.store(true, Ordering::Relaxed);
                break;
            }

            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });

    // initialize progress
    let _ = progress_client
        .post(&progress_url)
        .json(&ProgressPayload {
            completed: 0,
            total: total_frames_usize,
        })
        .send()
        .await;

    // share progress
    let progress_url_clone = progress_url.clone();
    let completed_clone = completed.clone();
    let is_canceled_clone = is_canceled.clone();
    tokio::spawn(async move {
        loop {
            let _ = Client::new()
                .post(&progress_url_clone)
                .json(&ProgressPayload {
                    completed: completed_clone.load(Ordering::Relaxed),
                    total: total_frames,
                })
                .send()
                .await;

            if is_canceled_clone.load(Ordering::Relaxed) {
                break;
            }

            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    });

    // Render page URL:
    // - Dev: defaults to Vite dev server.
    // - Non-dev: Electron can pass a `file://.../dist-render/render.html` URL.
    let url = std::env::var("RENDER_PAGE_URL")
        .or_else(|_| std::env::var("RENDER_DEV_SERVER_URL"))
        .unwrap_or_else(|_| "http://localhost:5174/render".to_string());

    let mut tasks = FuturesUnordered::new();

    static DIRECTORY: &'static str = "frames";
    let output_path =
        std::env::var("RENDER_OUTPUT_PATH").unwrap_or_else(|_| "output.mp4".to_string());
    let output_path = PathBuf::from(output_path);

    tokio::fs::remove_dir_all(DIRECTORY).await.ok();
    tokio::fs::create_dir(DIRECTORY).await?;

    let start = Instant::now();

    let mut ranges = Vec::new();
    for worker_id in 0..worker_count {
        let start = worker_id * base_chunk;
        let end = start + base_chunk;
        if start < end {
            ranges.push((start, end));
        }
    }
    if remainder > 0 {
        let start = worker_count * base_chunk;
        let end = total_frames;
        if start < end {
            ranges.push((start, end));
        }
    }

    for (worker_id, (start, end)) in ranges.into_iter().enumerate() {
        let encode_clone = encode.clone();
        let preset_clone = preset.clone();
        let ffmpeg_threads_clone = ffmpeg_threads;
        let ffmpeg_low_memory_clone = ffmpeg_low_memory;

        let page_url = url.clone();
        let completed_clone = completed.clone();
        let is_canceled_clone = is_canceled.clone();
        tasks.push(tokio::spawn(async move {
            let (mut browser, mut handler) = spawn_browser_instance(worker_id, width, height)
                .await
                .unwrap();

            tokio::spawn(async move { while handler.next().await.is_some() {} });

            let out = format!("{}/segment-{worker_id:03}.mp4", DIRECTORY);

            let mut writer = SegmentWriter::new(
                &out,
                width,
                height,
                fps,
                18,
                &encode_clone,
                Some(&preset_clone),
                Some(fps as u32),
                ffmpeg_threads_clone,
                ffmpeg_low_memory_clone,
            )
            .await
            .unwrap();

            let page = browser.new_page(page_url).await.unwrap();
            page.wait_for_navigation().await.unwrap();
            wait_for_frame_api(&page).await;
            wait_for_animation_ready(&page).await;
            wait_for_draw_text_ready(&page).await;
            wait_for_webgl_ready(&page).await;

            for frame in start..end {
                wait_for_next_frame(&page).await;

                let js = format!(
                    r#"
                    (() => {{
                      const api = window.__frameScript;
                      if (api && typeof api.setFrame === "function") {{
                        api.setFrame({});
                      }}
                    }})()
                    "#,
                    frame
                );
                page.evaluate(js).await.unwrap();

                wait_for_next_frame(&page).await;

                let script = format!(
                    r#"
                    (async () => {{
                      const api = window.__frameScript;
                      if (api && typeof api.waitCanvasFrame === "function") {{
                        try {{
                          await api.waitCanvasFrame({});
                        }} catch (_e) {{
                          // ignore
                        }}
                      }}
                    }})()
                "#,
                    frame
                );
                page.evaluate(script).await.unwrap();

                wait_for_images_ready(&page).await;
                wait_for_webgl_frame(&page, frame).await;

                let bytes = page
                    .screenshot(
                        ScreenshotParams::builder()
                            .format(CaptureScreenshotFormat::Png)
                            .omit_background(true)
                            .build(),
                    )
                    .await
                    .unwrap();

                writer.write_png_frame(&bytes).await.unwrap();

                completed_clone.fetch_add(1, Ordering::Relaxed);

                if is_canceled_clone.load(Ordering::Relaxed) {
                    break;
                }
            }

            writer.finish().await.unwrap();

            browser.close().await.unwrap();
        }));
    }

    while let Some(_) = tasks.next().await {}

    let mut segs = Vec::new();

    for worker_id in 0..worker_count + if remainder > 0 { 1 } else { 0 } {
        let path = PathBuf::from(format!("{}/segment-{worker_id:03}.mp4", DIRECTORY));
        if tokio::fs::metadata(&path).await.is_ok() {
            segs.push(path);
        }
    }

    let working_output = PathBuf::from("frames/output.mp4");
    crate::ffmpeg::concat_segments_mp4(segs, &working_output).await?;

    let audio_plan_url = std::env::var("RENDER_AUDIO_PLAN_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:3000/render_audio_plan".to_string());
    if let Ok(resp) = Client::new().get(&audio_plan_url).send().await {
        if resp.status().is_success() {
            if let Ok(plan) = resp.json::<AudioPlanResolved>().await {
                if !plan.segments.is_empty() {
                    let input_video = working_output.clone();
                    let temp_video = PathBuf::from("frames/output.audio.mp4");
                    mux_audio_plan_into_mp4(&input_video, &temp_video, &plan, total_frames, fps)
                        .await?;
                    tokio::fs::remove_file(&input_video).await.ok();
                    tokio::fs::rename(&temp_video, &input_video).await?;
                }
            }
        }
    }

    if output_path != working_output {
        if let Some(parent) = output_path.parent() {
            tokio::fs::create_dir_all(parent).await.ok();
        }
        tokio::fs::remove_file(&output_path).await.ok();
        if let Err(err) = tokio::fs::rename(&working_output, &output_path).await {
            eprintln!("[render] rename failed ({}), falling back to copy", err);
            if tokio::fs::copy(&working_output, &output_path).await.is_ok() {
                tokio::fs::remove_file(&working_output).await.ok();
            }
        }
    }

    let final_completed = completed.load(Ordering::Relaxed);
    let _ = progress_client
        .post(&progress_url)
        .json(&ProgressPayload {
            completed: final_completed,
            total: total_frames_usize,
        })
        .send()
        .await;

    let reset_url = std::env::var("RENDER_RESET_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:3000/reset".to_string());
    let _ = progress_client.post(&reset_url).send().await;

    println!("TOTAL : {}[ms]", start.elapsed().as_millis());

    Ok(())
}
