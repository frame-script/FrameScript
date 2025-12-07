import { useEffect, useRef } from "react";
import { initWebGPU, uploadAndDrawFrame } from "./webgpu";
import { useCurrentFrame } from "../lib/frame";
import { PROJECT_SETTINGS } from "../../project/project";

type VideoCanvasProps = {
  video: string
}

export const VideoCanvas = ({ video }: VideoCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const currentFrame = useCurrentFrame();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let ws: WebSocket;

    (async () => {
      await initWebGPU(canvas);

      function connectBackend() {
        ws = new WebSocket("ws://localhost:3000/ws");
        ws.binaryType = "arraybuffer";

        ws.onopen = () => {
          console.log("ws connected");
        };

        ws.onmessage = (event) => {
          if (!(event.data instanceof ArrayBuffer)) return;
          const buffer = event.data as ArrayBuffer;
          const view = new DataView(buffer);

          const width = view.getUint32(0, true);
          const height = view.getUint32(4, true);
          //const frameIndex = view.getUint32(8, true);

          const bytes = new Uint8Array(buffer);
          const rgba = bytes.subarray(12);

          uploadAndDrawFrame(rgba, width, height);
        };

        ws.onerror = (e) => {
          console.error("ws error", e);
        };

        ws.onclose = () => {
          console.log("ws closed");
          connectBackend()
        };

        wsRef.current = ws;
      }

      if (!wsRef.current) {
        connectBackend()
      }
    })();

    return () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const req = {
      video,
      width: PROJECT_SETTINGS.width,
      height: PROJECT_SETTINGS.height,
      frame: currentFrame,
    };

    ws.send(JSON.stringify(req));
  }, [currentFrame]);

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={360}
      style={{
        width: 640,
        height: 360,
        border: "1px solid #444",
        backgroundColor: "#000",
      }}
    />
  );
};
