pub mod decoder;
pub mod ffmpeg;
pub mod future;
pub mod util;

use std::{net::SocketAddr, ops::Bound};

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
use tokio::io::{AsyncReadExt, AsyncSeekExt, SeekFrom};
use tokio::net::TcpListener;
use tokio_util::io::ReaderStream;
use tracing::{error, info};
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::{
    decoder::{DECODER, DecoderKey, set_max_cache_size},
    ffmpeg::{probe_video_duration_ms, probe_video_fps},
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

static RENDER_COMPLETED: AtomicUsize = AtomicUsize::new(0);
static RENDER_TOTAL: AtomicUsize = AtomicUsize::new(0);
static RENDER_CANCEL: AtomicUsize = AtomicUsize::new(0);

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
            "/set_cache_size",
            post(set_cache_size_handler).options(options_handler),
        )
        .route(
            "/render_progress",
            post(set_progress_handler)
                .get(get_progress_handler)
                .options(options_handler),
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

async fn healthz_handler() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    apply_cors(&mut headers);
    (headers, StatusCode::OK)
}

#[derive(Serialize)]
struct VideoMetadataResponse {
    duration_ms: u64,
    fps: f64,
}

async fn video_meta_handler(
    State(_state): State<AppState>,
    Query(VideoQuery { path }): Query<VideoQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    let resolved_path = resolve_path_to_string(&path).map_err(|_| StatusCode::BAD_REQUEST)?;
    let duration_ms =
        probe_video_duration_ms(&resolved_path).map_err(|_| StatusCode::BAD_REQUEST)?;

    let fps = probe_video_fps(&resolved_path).map_err(|_| StatusCode::BAD_REQUEST)?;

    let mut resp = Json(VideoMetadataResponse { duration_ms, fps }).into_response();
    apply_cors(resp.headers_mut());
    Ok(resp)
}

async fn handle_socket(mut socket: WebSocket, _state: AppState) {
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
                println!("REQUESTED!");
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

                println!("SEND!");

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
        RENDER_COMPLETED.store(completed.min(RENDER_TOTAL.load(Ordering::Relaxed)), Ordering::Relaxed);
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
