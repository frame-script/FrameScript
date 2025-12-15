import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { PROJECT_SETTINGS } from "../../../project/project";
import { useCurrentFrame } from "../frame";
import { useProvideClipDuration } from "../clip";
import { createManualPromise, type ManualPromise } from "../../util/promise";
import { normalizeVideo, video_fps, video_length, type VideoProps } from "./video";

// Track pending frame draws so headless callers can await completion.
const pendingFramePromises = new Set<Promise<void>>();

const trackPending = (manual: ManualPromise<void>) => {
  pendingFramePromises.add(manual.promise);
  manual.promise.finally(() => pendingFramePromises.delete(manual.promise));
};

export const VideoCanvasRender = ({ video, style }: VideoProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingMapRef = useRef<Map<number, { manual: ManualPromise<void>; projectFrame: number }>>(new Map());
  const waitersRef = useRef<Map<number, ManualPromise<void>>>(new Map());
  const lastDrawnFrameRef = useRef<number | null>(null);
  const requestedFrameRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const resolved = useMemo(() => normalizeVideo(video), [video]);
  const fps = useMemo(() => video_fps(resolved), [resolved]);
  const durationFrames = useMemo(() => video_length(resolved), [resolved]);
  useProvideClipDuration(durationFrames);

  const currentFrame = useCurrentFrame();
  const currentFrameRef = useRef(currentFrame);

  useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  // Keep canvas pixels in sync with its CSS size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const nextWidth = Math.max(1, Math.round(rect.width * dpr));
      const nextHeight = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const rejectPendingRequests = useCallback((reason: unknown) => {
    for (const entry of pendingMapRef.current.values()) {
      entry.manual.reject(reason);
    }
    pendingMapRef.current.clear();
  }, []);

  const resolveWaiters = useCallback((projectFrame: number) => {
    const prev = lastDrawnFrameRef.current ?? -Infinity;
    if (projectFrame > prev) {
      lastDrawnFrameRef.current = projectFrame;
    }

    for (const [target, waiter] of Array.from(waitersRef.current.entries())) {
      if (projectFrame >= target) {
        waitersRef.current.delete(target);
        waiter.resolve();
      }
    }
  }, []);

  const sendFrameRequest = useCallback(
    (frame: number) => {
      const hasDuration = durationFrames > 0;
      const maxFrame = hasDuration ? Math.max(0, durationFrames - 1) : undefined;
      const clampedFrame =
        maxFrame !== undefined ? Math.min(Math.max(frame, 0), maxFrame) : Math.max(frame, 0);

      const durationSeconds =
        durationFrames > 0 ? durationFrames / Math.max(1, PROJECT_SETTINGS.fps) : null;
      const playbackMax =
        durationSeconds != null && fps > 0
          ? Math.max(0, Math.floor(durationSeconds * fps))
          : null;

      requestedFrameRef.current = clampedFrame;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return;
      }

      const playbackFrameRaw =
        fps > 0
          ? Math.round((clampedFrame * fps) / PROJECT_SETTINGS.fps)
          : Math.round(clampedFrame);
      const playbackFrame =
        playbackMax !== null
          ? Math.min(Math.max(playbackFrameRaw, 0), playbackMax)
          : Math.max(playbackFrameRaw, 0);

      const alreadyDrawn =
        lastDrawnFrameRef.current != null && lastDrawnFrameRef.current >= clampedFrame;
      const hasPendingSamePlayback = pendingMapRef.current.has(playbackFrame);
      if (alreadyDrawn && !hasPendingSamePlayback) {
        return;
      }

      const manual = createManualPromise();
      trackPending(manual);

      const existing = pendingMapRef.current.get(playbackFrame);
      if (existing) {
        existing.manual.reject(new Error("superseded by newer request"));
      }
      pendingMapRef.current.set(playbackFrame, { manual, projectFrame: clampedFrame });

      const req = {
        video: resolved.path,
        width: PROJECT_SETTINGS.width,
        height: PROJECT_SETTINGS.height,
        frame: playbackFrame,
      };

      ws.send(JSON.stringify(req));
    },
    [durationFrames, fps, resolved.path],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (reconnectTimerRef.current != null) return;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, 300);
    };

    const handleDisconnect = (reason: unknown) => {
      rejectPendingRequests(reason);
      wsRef.current = null;
      scheduleReconnect();
    };

    const connect = () => {
      if (wsRef.current) return;
      const socket = new WebSocket("ws://localhost:3000/ws");
      socket.binaryType = "arraybuffer";
      wsRef.current = socket;

      socket.onopen = () => {
        clearReconnectTimer();
        const target = requestedFrameRef.current ?? currentFrameRef.current;
        sendFrameRequest(target);
      };

      socket.onmessage = (event) => {
        if (!(event.data instanceof ArrayBuffer)) return;
        const buffer = event.data as ArrayBuffer;
        const view = new DataView(buffer);
        const width = view.getUint32(0, true);
        const height = view.getUint32(4, true);
        const frameIndex = view.getUint32(8, true);
        const rgba = new Uint8ClampedArray(buffer, 12);

        if (width * height * 4 !== rgba.length) {
          rejectPendingRequests(new Error("frame size mismatch"));
          return;
        }

        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }

        const imageData = new ImageData(rgba, width, height);
        ctx.putImageData(imageData, 0, 0);

        const pending = pendingMapRef.current.get(frameIndex);
        const projectFrame =
          pending?.projectFrame ??
          Math.round((frameIndex * PROJECT_SETTINGS.fps) / Math.max(1, fps || PROJECT_SETTINGS.fps));

        if (pending) {
          pendingMapRef.current.delete(frameIndex);
          pending.manual.resolve();
        }

        resolveWaiters(projectFrame);
      };

      socket.onerror = (event) => {
        handleDisconnect(event);
      };

      socket.onclose = () => {
        handleDisconnect(new Error("socket closed"));
      };
    };

    connect();

    return () => {
      clearReconnectTimer();
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      rejectPendingRequests(new Error("component unmounted"));
    };
  }, [rejectPendingRequests, resolveWaiters, sendFrameRequest]);

  useEffect(() => {
    sendFrameRequest(currentFrame);
  }, [currentFrame, sendFrameRequest]);

  const waitCanvasFrame = useCallback(
    async (frame?: number) => {
      const hasDuration = durationFrames > 0;
      const maxFrame = hasDuration ? Math.max(0, durationFrames - 1) : undefined;
      const rawTarget = frame ?? currentFrameRef.current ?? 0;
      const target =
        maxFrame !== undefined ? Math.min(Math.max(rawTarget, 0), maxFrame) : Math.max(rawTarget, 0);

      const alreadyDrawn = lastDrawnFrameRef.current != null && lastDrawnFrameRef.current >= target;
      const hasPending = pendingMapRef.current.size > 0;

      if (alreadyDrawn && !hasPending) {
        return;
      }

      const manual = createManualPromise();
      trackPending(manual);
      waitersRef.current.set(target, manual);
      await manual.promise;
    },
    [durationFrames],
  );

  (window as any).__frameScript = {
    ...(window as any).__frameScript,
    waitCanvasFrame,
  };

  const baseStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    border: "1px solid #444",
    backgroundColor: "#000",
    display: "block",
  };

  return (
    <canvas
      ref={canvasRef}
      width={PROJECT_SETTINGS.width}
      height={PROJECT_SETTINGS.height}
      style={style ? { ...baseStyle, ...style } : baseStyle}
    />
  );
};
