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
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
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

async fn spawn_browser_instance(
    profile_id: usize,
    width: u32,
    height: u32,
) -> Result<(Browser, Handler), Box<dyn std::error::Error>> {
    // 一時ディレクトリをブラウザプロファイルとして使う
    let tmp = TempDir::new()?; // ライフタイム管理は適宜
    let user_data_dir: PathBuf = tmp.path().join(format!("profile-{}", profile_id));

    let config = BrowserConfig::builder()
        .new_headless_mode()
        .viewport(Viewport {
            width,
            height,
            device_scale_factor: None,
            emulating_mobile: false,
            is_landscape: false,
            has_touch: false,
        })
        .request_timeout(Duration::from_hours(24))
        .user_data_dir(user_data_dir) // ★ インスタンスごとに別のディレクトリ
        .build()?;

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

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = std::env::args().collect::<Vec<String>>();

    if args.len() < 2 {
        return Err("Invalid command.".into());
    }

    let splited = args[1].split(":").collect::<Vec<_>>();

    if splited.len() != 7 {
        return Err("Invalid command(split).".into());
    }

    let width = splited[0].parse::<u32>()?;
    let height = splited[1].parse::<u32>()?;
    let fps = splited[2].parse::<f64>()?;
    let total_frames = splited[3].parse::<usize>()?;
    let workers = splited[4].parse::<usize>()?;
    let encode = splited[5].to_string();
    let preset = splited[6].to_string();

    let chunk = total_frames / (workers - 1).max(1);
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

    //let file = format!("file://{}", canonicalize("index.html")?.to_string_lossy());
    let url = std::env::var("RENDER_DEV_SERVER_URL")
        .unwrap_or_else(|_| "http://localhost:5174/render".to_string());

    let mut tasks = FuturesUnordered::new();

    static DIRECTORY: &'static str = "frames";

    tokio::fs::remove_dir_all(DIRECTORY).await.ok();
    tokio::fs::create_dir(DIRECTORY).await?;

    let start = Instant::now();

    for worker_id in 0..workers {
        let start = worker_id * chunk;
        let end = ((worker_id + 1) * chunk).min(total_frames);

        let encode_clone = encode.clone();
        let preset_clone = preset.clone();

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
            )
            .await
            .unwrap();

            let page = browser.new_page(page_url).await.unwrap();
            page.wait_for_navigation().await.unwrap();

            for frame in start..end {
                wait_for_next_frame(&page).await;

                let js = format!(
                    r#"
                    window.__frameScript.setFrame({})
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

    for worker_id in 0..workers {
        let path = PathBuf::from(format!("{}/segment-{worker_id:03}.mp4", DIRECTORY));
        if tokio::fs::metadata(&path).await.is_ok() {
            segs.push(path);
        }
    }

    crate::ffmpeg::concat_segments_mp4(segs, &PathBuf::from("frames/output.mp4")).await?;

    let audio_plan_url = std::env::var("RENDER_AUDIO_PLAN_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:3000/render_audio_plan".to_string());
    if let Ok(resp) = Client::new().get(&audio_plan_url).send().await {
        if resp.status().is_success() {
            if let Ok(plan) = resp.json::<AudioPlanResolved>().await {
                if !plan.segments.is_empty() {
                    let input_video = PathBuf::from("frames/output.mp4");
                    let temp_video = PathBuf::from("frames/output.audio.mp4");
                    mux_audio_plan_into_mp4(&input_video, &temp_video, &plan, total_frames, fps)
                        .await?;
                    tokio::fs::remove_file(&input_video).await.ok();
                    tokio::fs::rename(&temp_video, &input_video).await?;
                }
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
