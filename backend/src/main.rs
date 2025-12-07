pub mod decoder;
pub mod ffmpeg;
pub mod future;
pub mod util;

use std::net::SocketAddr;

use axum::{
    Router,
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::IntoResponse,
    routing::get,
    serve,
};
use futures_util::StreamExt;
use serde::Deserialize;
use tokio::net::TcpListener;
use tracing::{error, info};

use crate::{decoder::DECODER, util::resolve_path_to_string};

#[derive(Clone)]
struct AppState;

#[derive(Deserialize, Debug)]
struct FrameRequest {
    video: String,
    width: u32,
    height: u32,
    frame: u32,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let app_state = AppState;
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .with_state(app_state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    info!("listening on {addr}");

    let listener = TcpListener::bind(addr).await.unwrap();

    serve(listener, app).await.unwrap();
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
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
                let req: FrameRequest = match serde_json::from_str(&text) {
                    Ok(r) => r,
                    Err(e) => {
                        error!("invalid request: {e}, text={text}");
                        continue;
                    }
                };

                let width = req.width;
                let height = req.height;
                let frame_index = req.frame;

                let decoder = DECODER
                    .decoder(resolve_path_to_string(&req.video).unwrap_or(req.video))
                    .await;

                let frame_rgba = decoder.request_frame(width, height, frame_index as _).await;

                // into [width][height][frame_index][rgba...] packet
                let mut packet = Vec::with_capacity(12 + frame_rgba.len());
                packet.extend_from_slice(&width.to_le_bytes());
                packet.extend_from_slice(&height.to_le_bytes());
                packet.extend_from_slice(&frame_index.to_le_bytes());
                packet.extend_from_slice(&frame_rgba);

                if let Err(e) = socket.send(Message::Binary(packet)).await {
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

fn generate_dummy_frame(width: u32, height: u32, frame: u32, video: &str) -> Vec<u8> {
    let mut buf = vec![0u8; (width * height * 4) as usize];

    let hash = video.bytes().fold(0u8, |acc, b| acc.wrapping_add(b)) % (frame as u8 + 1);

    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;

            let r = (x * 255 / width) as u8 ^ hash;
            let g = (y * 255 / height) as u8 ^ (frame as u8);
            let b = 128u8;
            let a = 255u8;

            buf[idx] = r;
            buf[idx + 1] = g;
            buf[idx + 2] = b;
            buf[idx + 3] = a;
        }
    }

    buf
}
