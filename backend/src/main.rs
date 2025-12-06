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

#[derive(Clone)]
struct AppState;

#[derive(Deserialize, Debug)]
struct FrameRequest {
    video: String,
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
                // クライアントからの「動画名 + フレーム番号」リクエスト
                let req: FrameRequest = match serde_json::from_str(&text) {
                    Ok(r) => r,
                    Err(e) => {
                        error!("invalid request: {e}, text={text}");
                        continue;
                    }
                };

                // 本来はここで video + frame から実フレームを取り出す
                let width: u32 = 640;
                let height: u32 = 360;
                let frame_index = req.frame;

                let frame_rgba = generate_dummy_frame(width, height, frame_index, &req.video);

                // [width][height][frame_index][rgba...] のパケットにする
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
            Message::Binary(_) => {
                // 今回はクライアントからバイナリは受け取らない
            }
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

// ダミーフレーム生成（動画名とフレーム番号で色を変えるだけ）
fn generate_dummy_frame(width: u32, height: u32, frame: u32, video: &str) -> Vec<u8> {
    let mut buf = vec![0u8; (width * height * 4) as usize];

    // 動画名から簡単なハッシュ値を作って色を変える
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
