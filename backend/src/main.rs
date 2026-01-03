pub mod decoder;
pub mod ffmpeg;
pub mod future;
pub mod util;

use std::{net::SocketAddr, ops::Bound, sync::atomic::AtomicBool, time::{SystemTime, UNIX_EPOCH}};

use axum::{
    Router,
    body::Bytes,
    extract::{
        Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Json},
    routing::{get, post},
    serve,
};
use axum_extra::{TypedHeader, headers::Range};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};
use tokio::net::TcpListener;
use tokio_util::io::ReaderStream;
use tracing::{error, info};

use crate::{
    decoder::{DECODER, DecoderKey, set_max_cache_size},
    ffmpeg::{probe_audio_duration_ms, probe_video_dimensions, probe_video_duration_ms, probe_video_fps},
    util::resolve_path_to_string,
};

#[derive(Deserialize)]
struct VideoQuery {
    path: String,
}

#[derive(Deserialize)]
struct AudioQuery {
    path: String,
}

#[derive(Deserialize)]
struct FileQuery {
    path: String,
}

#[derive(Clone)]
struct AppState;

#[derive(Deserialize, Debug)]
struct FrameRequest {
    video: String,
    width: u32,
    height: u32,
    frame: u32,
}

#[derive(Deserialize)]
struct CacheSizeRequest {
    gib: usize,
}

#[derive(Deserialize)]
struct ProgressRequest {
    completed: Option<usize>,
    total: Option<usize>,
}

#[derive(Serialize)]
struct ProgressResponse {
    completed: usize,
    total: usize,
}

#[derive(Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum AudioSourceRef {
    Video { path: String },
    Sound { path: String },
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
enum AudioLoudnessPreset {
    Youtube,
}

#[derive(Deserialize, Clone)]
struct AudioSegment {
    id: String,
    source: AudioSourceRef,
    #[serde(rename = "projectStartFrame")]
    project_start_frame: i64,
    #[serde(rename = "sourceStartFrame")]
    source_start_frame: i64,
    #[serde(rename = "durationFrames")]
    duration_frames: i64,
    #[serde(rename = "fadeInFrames")]
    fade_in_frames: Option<i64>,
    #[serde(rename = "fadeOutFrames")]
    fade_out_frames: Option<i64>,
    volume: Option<f64>,
}

#[derive(Deserialize, Clone)]
struct AudioPlanRequest {
    fps: f64,
    segments: Vec<AudioSegment>,
    loudness: Option<AudioLoudnessPreset>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum AudioSourceResolved {
    Video { path: String },
    Sound { path: String },
}

#[derive(Serialize, Clone)]
struct AudioSegmentResolved {
    id: String,
    source: AudioSourceResolved,
    #[serde(rename = "projectStartFrame")]
    project_start_frame: i64,
    #[serde(rename = "sourceStartFrame")]
    source_start_frame: i64,
    #[serde(rename = "durationFrames")]
    duration_frames: i64,
    #[serde(rename = "fadeInFrames")]
    fade_in_frames: i64,
    #[serde(rename = "fadeOutFrames")]
    fade_out_frames: i64,
    volume: f64,
}

#[derive(Serialize, Clone)]
struct AudioPlanResolved {
    fps: f64,
    segments: Vec<AudioSegmentResolved>,
    loudness: Option<AudioLoudnessPreset>,
}

#[derive(Deserialize)]
struct RenderLogRequest {
    message: String,
    level: Option<String>,
    session: Option<String>,
    context: Option<serde_json::Value>,
}

#[derive(Serialize, Clone)]
struct RenderLogEntry {
    timestamp_ms: u64,
    message: String,
    level: String,
    session: Option<String>,
    context: Option<serde_json::Value>,
}

static RENDER_AUDIO_PLAN: std::sync::LazyLock<std::sync::Mutex<Option<AudioPlanResolved>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(None));
static RENDER_LOGS: std::sync::LazyLock<std::sync::Mutex<Vec<RenderLogEntry>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(Vec::new()));

static RENDER_COMPLETED: AtomicUsize = AtomicUsize::new(0);
static RENDER_TOTAL: AtomicUsize = AtomicUsize::new(0);
static RENDER_CANCEL: AtomicBool = AtomicBool::new(false);
static NEXT_SESSION_ID: AtomicUsize = AtomicUsize::new(1);
const MAX_RENDER_LOGS: usize = 2000;

#[tokio::main]
async fn main() {
    unsafe {
        std::env::set_var("LIBVA_DRIVER_NAME", "radeonsi");
    };

    tracing_subscriber::fmt::init();

    let app_state = AppState;
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/video", get(video_handler).options(options_handler))
        .route(
            "/video/meta",
            get(video_meta_handler).options(options_handler),
        )
        .route("/audio", get(audio_handler).options(options_handler))
        .route(
            "/audio/meta",
            get(audio_meta_handler).options(options_handler),
        )
        .route("/file", get(file_handler).options(options_handler))
        .route(
            "/set_cache_size",
            post(set_cache_size_handler).options(options_handler),
        )
        .route(
            "/render_progress",
            post(set_progress_handler)
                .get(get_progress_handler)
                .options(options_handler),
        )
        .route(
            "/render_log",
            post(render_log_handler)
                .get(get_render_log_handler)
                .options(options_handler),
        )
        .route(
            "/render_cancel",
            post(render_cancel_handler).options(options_handler),
        )
        .route(
            "/render_audio_plan",
            post(set_audio_plan_handler)
                .get(get_audio_plan_handler)
                .options(options_handler),
        )
        .route("/reset", post(reset_handler).options(options_handler))
        .route(
            "/is_canceled",
            get(is_canceled_handler).options(options_handler),
        )
        .route("/healthz", get(healthz_handler).options(options_handler))
        .with_state(app_state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    let listener = TcpListener::bind(addr).await.unwrap();
    info!("listening on {addr}");
    println!("[backend ready] listening on {addr}");

    serve(listener, app).await.unwrap();
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn video_handler(
    State(_state): State<AppState>,
    Query(VideoQuery { path }): Query<VideoQuery>,
    range: Option<TypedHeader<Range>>,
) -> Result<impl IntoResponse, StatusCode> {
    let resolved_path = resolve_path_to_string(&path).map_err(|_| StatusCode::BAD_REQUEST)?;
    let mut file = tokio::fs::File::open(&resolved_path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let metadata = file
        .metadata()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let len = metadata.len();

    let (status, body, content_range, content_length) = if let Some(TypedHeader(range)) = range {
        let mut iter = range.satisfiable_ranges(len);

        if let Some((start_bound, end_bound)) = iter.next() {
            let start = match start_bound {
                Bound::Included(n) => n,
                Bound::Excluded(n) => n + 1,
                Bound::Unbounded => 0,
            };

            let end = match end_bound {
                Bound::Included(n) => n,
                Bound::Excluded(n) => n.saturating_sub(1),
                Bound::Unbounded => len.saturating_sub(1),
            };

            if start >= len || end >= len || start > end {
                return Err(StatusCode::RANGE_NOT_SATISFIABLE);
            }

            let chunk_size = end - start + 1;

            file.seek(SeekFrom::Start(start))
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let stream = ReaderStream::with_capacity(file.take(chunk_size), 16 * 1024);
            let range_header = format!("bytes {}-{}/{}", start, end, len);

            (
                StatusCode::PARTIAL_CONTENT,
                stream,
                Some(range_header),
                chunk_size,
            )
        } else {
            return Err(StatusCode::RANGE_NOT_SATISFIABLE);
        }
    } else {
        // Range ヘッダなし => 全体を返す
        let stream = ReaderStream::with_capacity(file.take(len), 16 * 1024);
        (StatusCode::OK, stream, None, len)
    };

    let mut resp = axum::response::Response::new(axum::body::Body::from_stream(body));
    *resp.status_mut() = status;

    let headers = resp.headers_mut();
    headers.insert(
        header::ACCEPT_RANGES,
        header::HeaderValue::from_static("bytes"),
    );
    if let Ok(v) = header::HeaderValue::from_str(&content_length.to_string()) {
        headers.insert(header::CONTENT_LENGTH, v);
    }
    headers.insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("video/mp4"),
    );
    if let Some(range_str) = content_range {
        headers.insert(
            header::CONTENT_RANGE,
            header::HeaderValue::from_str(&range_str)
                .unwrap_or_else(|_| header::HeaderValue::from_static("bytes */*")),
        );
    }
    apply_cors(headers);

    Ok(resp)
}

async fn audio_handler(
    State(_state): State<AppState>,
    Query(AudioQuery { path }): Query<AudioQuery>,
    range: Option<TypedHeader<Range>>,
) -> Result<impl IntoResponse, StatusCode> {
    let resolved_path = resolve_path_to_string(&path).map_err(|_| StatusCode::BAD_REQUEST)?;
    let mut file = tokio::fs::File::open(&resolved_path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let metadata = file
        .metadata()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let len = metadata.len();

    let (status, body, content_range, content_length) = if let Some(TypedHeader(range)) = range {
        let mut iter = range.satisfiable_ranges(len);

        if let Some((start_bound, end_bound)) = iter.next() {
            let start = match start_bound {
                Bound::Included(n) => n,
                Bound::Excluded(n) => n + 1,
                Bound::Unbounded => 0,
            };

            let end = match end_bound {
                Bound::Included(n) => n,
                Bound::Excluded(n) => n.saturating_sub(1),
                Bound::Unbounded => len.saturating_sub(1),
            };

            if start >= len || end >= len || start > end {
                return Err(StatusCode::RANGE_NOT_SATISFIABLE);
            }

            let chunk_size = end - start + 1;

            file.seek(SeekFrom::Start(start))
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let stream = ReaderStream::with_capacity(file.take(chunk_size), 16 * 1024);
            let range_header = format!("bytes {}-{}/{}", start, end, len);

            (
                StatusCode::PARTIAL_CONTENT,
                stream,
                Some(range_header),
                chunk_size,
            )
        } else {
            return Err(StatusCode::RANGE_NOT_SATISFIABLE);
        }
    } else {
        // Range ヘッダなし => 全体を返す
        let stream = ReaderStream::with_capacity(file.take(len), 16 * 1024);
        (StatusCode::OK, stream, None, len)
    };

    let mut resp = axum::response::Response::new(axum::body::Body::from_stream(body));
    *resp.status_mut() = status;

    let headers = resp.headers_mut();
    headers.insert(
        header::ACCEPT_RANGES,
        header::HeaderValue::from_static("bytes"),
    );
    if let Ok(v) = header::HeaderValue::from_str(&content_length.to_string()) {
        headers.insert(header::CONTENT_LENGTH, v);
    }
    headers.insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("audio/mp4"),
    );
    if let Some(range_str) = content_range {
        headers.insert(
            header::CONTENT_RANGE,
            header::HeaderValue::from_str(&range_str)
                .unwrap_or_else(|_| header::HeaderValue::from_static("bytes */*")),
        );
    }
    apply_cors(headers);

    Ok(resp)
}

fn cors_status(status: StatusCode) -> axum::response::Response {
    let mut resp = axum::response::Response::new(axum::body::Body::empty());
    *resp.status_mut() = status;
    apply_cors(resp.headers_mut());
    resp
}

async fn file_handler(
    State(_state): State<AppState>,
    Query(FileQuery { path }): Query<FileQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    let resolved_path = match resolve_path_to_string(&path) {
        Ok(value) => value,
        Err(_) => return Ok(cors_status(StatusCode::BAD_REQUEST)),
    };
    let file = match tokio::fs::File::open(&resolved_path).await {
        Ok(value) => value,
        Err(_) => return Ok(cors_status(StatusCode::NOT_FOUND)),
    };
    let metadata = match file.metadata().await {
        Ok(value) => value,
        Err(_) => return Ok(cors_status(StatusCode::INTERNAL_SERVER_ERROR)),
    };
    let len = metadata.len();

    let stream = ReaderStream::with_capacity(file.take(len), 16 * 1024);
    let mut resp = axum::response::Response::new(axum::body::Body::from_stream(stream));
    *resp.status_mut() = StatusCode::OK;

    let headers = resp.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/octet-stream"),
    );
    if let Ok(v) = header::HeaderValue::from_str(&len.to_string()) {
        headers.insert(header::CONTENT_LENGTH, v);
    }
    apply_cors(headers);

    Ok(resp)
}

async fn healthz_handler() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    apply_cors(&mut headers);
    (headers, StatusCode::OK)
}

#[derive(Serialize)]
struct VideoMetadataResponse {
    duration_ms: u64,
    fps: f64,
    width: u32,
    height: u32,
}

async fn video_meta_handler(
    State(_state): State<AppState>,
    Query(VideoQuery { path }): Query<VideoQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    let resolved_path = resolve_path_to_string(&path).map_err(|_| StatusCode::BAD_REQUEST)?;
    let duration_ms =
        probe_video_duration_ms(&resolved_path).map_err(|_| StatusCode::BAD_REQUEST)?;

    let fps = probe_video_fps(&resolved_path).map_err(|_| StatusCode::BAD_REQUEST)?;
    let (width, height) =
        probe_video_dimensions(&resolved_path).map_err(|_| StatusCode::BAD_REQUEST)?;

    let mut resp = Json(VideoMetadataResponse { duration_ms, fps, width, height }).into_response();
    apply_cors(resp.headers_mut());
    Ok(resp)
}

#[derive(Serialize)]
struct AudioMetadataResponse {
    duration_ms: u64,
}

async fn audio_meta_handler(
    State(_state): State<AppState>,
    Query(AudioQuery { path }): Query<AudioQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    let resolved_path = resolve_path_to_string(&path).map_err(|_| StatusCode::BAD_REQUEST)?;
    let duration_ms =
        probe_audio_duration_ms(&resolved_path).map_err(|_| StatusCode::BAD_REQUEST)?;

    let mut resp = Json(AudioMetadataResponse { duration_ms }).into_response();
    apply_cors(resp.headers_mut());
    Ok(resp)
}

async fn handle_socket(mut socket: WebSocket, _state: AppState) {
    let session_id = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed) as u64;
    info!("client connected");

    while let Some(msg) = socket.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(e) => {
                error!("ws error: {e}");
                break;
            }
        };

        match msg {
            Message::Text(text) => {
                let req: FrameRequest = match serde_json::from_str(&text) {
                    Ok(r) => r,
                    Err(e) => {
                        error!("invalid request: {e}, text={text}");
                        continue;
                    }
                };

                let width = req.width;
                let height = req.height;
                let target_frame = req.frame;

                let path = resolve_path_to_string(&req.video).unwrap_or_default();

                let decoder = DECODER
                    .cached_decoder(DecoderKey {
                        path,
                        width,
                        height,
                        session_id,
                    })
                    .await;
                let frame_rgba = decoder.get_frame(target_frame).await;

                // into [width][height][frame_index][rgba...] packet
                let mut packet = Vec::with_capacity(12 + frame_rgba.len());
                packet.extend_from_slice(&width.to_le_bytes());
                packet.extend_from_slice(&height.to_le_bytes());
                packet.extend_from_slice(&target_frame.to_le_bytes());
                packet.extend_from_slice(&frame_rgba);

                let bytes = Bytes::from(packet);

                if let Err(e) = socket.send(Message::Binary(bytes)).await {
                    error!("failed to send frame: {e}");
                    break;
                }
            }
            Message::Binary(_) => {}
            Message::Ping(p) => {
                let _ = socket.send(Message::Pong(p)).await;
            }
            Message::Pong(_) => {}
            Message::Close(_) => {
                info!("client closed");
                break;
            }
        }
    }

    DECODER.clear_session(session_id);
    info!("client disconnected");
}

async fn options_handler() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    apply_cors(&mut headers);
    (headers, StatusCode::NO_CONTENT)
}

async fn set_cache_size_handler(
    State(_state): State<AppState>,
    Json(payload): Json<CacheSizeRequest>,
) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    apply_cors(&mut headers);

    let gib = payload.gib.max(1).min(128); // clamp to a sane range
    let bytes = gib as usize * 1024 * 1024 * 1024;
    set_max_cache_size(bytes);

    (headers, StatusCode::OK)
}

async fn set_progress_handler(
    State(_state): State<AppState>,
    Json(payload): Json<ProgressRequest>,
) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    apply_cors(&mut headers);

    if let Some(total) = payload.total {
        RENDER_TOTAL.store(total, Ordering::Relaxed);
    }
    if let Some(completed) = payload.completed {
        RENDER_COMPLETED.store(
            completed.min(RENDER_TOTAL.load(Ordering::Relaxed)),
            Ordering::Relaxed,
        );
    }

    (headers, StatusCode::OK)
}

async fn get_progress_handler(State(_state): State<AppState>) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    apply_cors(&mut headers);

    let response = ProgressResponse {
        completed: RENDER_COMPLETED.load(Ordering::Relaxed),
        total: RENDER_TOTAL.load(Ordering::Relaxed),
    };

    (headers, Json(response))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

async fn render_log_handler(
    State(_state): State<AppState>,
    Json(payload): Json<RenderLogRequest>,
) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    apply_cors(&mut headers);

    let entry = RenderLogEntry {
        timestamp_ms: now_ms(),
        message: payload.message,
        level: payload.level.unwrap_or_else(|| "info".to_string()),
        session: payload.session,
        context: payload.context,
    };

    {
        let mut logs = RENDER_LOGS.lock().unwrap();
        logs.push(entry.clone());
        if logs.len() > MAX_RENDER_LOGS {
            let trim = logs.len() - MAX_RENDER_LOGS;
            logs.drain(0..trim);
        }
    }

    let session = entry.session.as_deref().unwrap_or("-");
    let context = entry
        .context
        .as_ref()
        .map(|value| value.to_string())
        .unwrap_or_default();
    info!(
        "[render_log:{}] {} session={} context={}",
        entry.level, entry.message, session, context
    );

    (headers, StatusCode::OK)
}

async fn get_render_log_handler(State(_state): State<AppState>) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    apply_cors(&mut headers);

    let logs = RENDER_LOGS.lock().unwrap().clone();
    (headers, Json(logs))
}

async fn render_cancel_handler(State(_state): State<AppState>) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    apply_cors(&mut headers);
    RENDER_CANCEL.store(true, Ordering::Relaxed);
    (headers, StatusCode::OK)
}

async fn is_canceled_handler(State(_state): State<AppState>) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    apply_cors(&mut headers);
    let canceled = RENDER_CANCEL.load(Ordering::Relaxed);
    (headers, Json(serde_json::json!({ "canceled": canceled })))
}

async fn reset_handler(State(_state): State<AppState>) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    apply_cors(&mut headers);
    DECODER.clear().await;
    RENDER_CANCEL.store(false, Ordering::Relaxed);
    *RENDER_AUDIO_PLAN.lock().unwrap() = None;
    RENDER_LOGS.lock().unwrap().clear();
    (headers, StatusCode::OK)
}

async fn set_audio_plan_handler(
    State(_state): State<AppState>,
    Json(payload): Json<AudioPlanRequest>,
) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    apply_cors(&mut headers);

    let fps = if payload.fps.is_finite() && payload.fps > 0.0 {
        payload.fps
    } else {
        60.0
    };

    let mut segments = Vec::new();
    for seg in payload.segments.into_iter() {
        let duration_frames = seg.duration_frames.max(0);
        if duration_frames == 0 {
            continue;
        }

        let project_start_frame = seg.project_start_frame.max(0);
        let source_start_frame = seg.source_start_frame.max(0);

        let resolved_source = match seg.source {
            AudioSourceRef::Video { path } => resolve_path_to_string(&path)
                .ok()
                .map(|p| AudioSourceResolved::Video { path: p }),
            AudioSourceRef::Sound { path } => resolve_path_to_string(&path)
                .ok()
                .map(|p| AudioSourceResolved::Sound { path: p }),
        };

        let Some(source) = resolved_source else {
            continue;
        };

        // Validate that the source actually has an audio stream, and clamp the segment to its duration.
        let source_path = match &source {
            AudioSourceResolved::Video { path } => path.as_str(),
            AudioSourceResolved::Sound { path } => path.as_str(),
        };
        let source_duration_ms = match probe_audio_duration_ms(source_path) {
            Ok(ms) if ms > 0 => ms,
            _ => continue,
        };
        let source_total_frames = ((source_duration_ms as f64 / 1000.0) * fps)
            .round()
            .max(0.0) as i64;
        let available = (source_total_frames - source_start_frame).max(0);
        let duration_frames = duration_frames.min(available);
        if duration_frames == 0 {
            continue;
        }

        let fade_in_frames = seg.fade_in_frames.unwrap_or(0).max(0).min(duration_frames);
        let fade_out_frames = seg
            .fade_out_frames
            .unwrap_or(0)
            .max(0)
            .min(duration_frames);
        let volume = match seg.volume {
            Some(value) if value.is_finite() => value.max(0.0),
            _ => 1.0,
        };

        segments.push(AudioSegmentResolved {
            id: seg.id,
            source,
            project_start_frame,
            source_start_frame,
            duration_frames,
            fade_in_frames,
            fade_out_frames,
            volume,
        });
    }

    *RENDER_AUDIO_PLAN.lock().unwrap() = Some(AudioPlanResolved {
        fps,
        segments,
        loudness: payload.loudness,
    });

    (headers, StatusCode::OK)
}

async fn get_audio_plan_handler(State(_state): State<AppState>) -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    apply_cors(&mut headers);

    let plan = RENDER_AUDIO_PLAN
        .lock()
        .unwrap()
        .clone()
        .unwrap_or(AudioPlanResolved {
            fps: 60.0,
            segments: Vec::new(),
            loudness: None,
        });

    (headers, Json(plan))
}

fn apply_cors(headers: &mut HeaderMap) {
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        HeaderValue::from_static("*"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, OPTIONS, POST"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("*"),
    );
}
