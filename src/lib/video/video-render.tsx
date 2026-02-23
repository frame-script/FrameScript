import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { PROJECT_SETTINGS } from "../../../project/project";
import { useCurrentFrame } from "../frame";
import { useClipActive, useClipStart, useProvideClipDuration } from "../clip";
import { createManualPromise, type ManualPromise } from "../../util/promise";
import {
  normalizeVideo,
  video_fps,
  video_frame_count,
  video_length,
  type Video,
  type VideoResolvedTrimProps,
} from "./video";

// Track pending frame draws so headless callers can await completion.
const pendingFramePromises = new Set<Promise<void>>();
const waitCanvasFrameCallbacks = new Map<string, (frame: number) => Promise<void>>();
const updateGlobalWaitCanvasFrame = () => {
  if (typeof window === "undefined") return;
  const api = ((window as any).__frameScript ||= {});
  api.waitCanvasFrame = async (frame: number) => {
    const callbacks = Array.from(waitCanvasFrameCallbacks.values());
    if (callbacks.length === 0) return;
    await Promise.all(callbacks.map((cb) => cb(frame)));
  };
};

const trackPending = (manual: ManualPromise<void>) => {
  pendingFramePromises.add(manual.promise);
  manual.promise.finally(() => pendingFramePromises.delete(manual.promise));
};

/**
 * Props for VideoCanvasRender (render-mode video canvas).
 *
 * レンダーモード用 VideoCanvasRender の props。
 *
 * @example
 * ```tsx
 * <VideoCanvasRender video="assets/demo.mp4" />
 * ```
 */
export type VideoCanvasRenderProps = {
  video: Video | string
  style?: CSSProperties
} & VideoResolvedTrimProps

/**
 * Renders video frames to a canvas in render mode.
 *
 * レンダーモードで動画フレームを canvas に描画します。
 *
 * @example
 * ```tsx
 * <VideoCanvasRender video="assets/demo.mp4" trimStartFrames={30} trimEndFrames={0} />
 * ```
 */
export const VideoCanvasRender = ({ video, style, trimStartFrames = 0, trimEndFrames = 0 }: VideoCanvasRenderProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const canvasSizeRef = useRef({ width: PROJECT_SETTINGS.width, height: PROJECT_SETTINGS.height });
  const pendingMapRef = useRef<Map<number, { manual: ManualPromise<void>; projectFrame: number }>>(new Map());
  const waitersRef = useRef<Map<number, ManualPromise<void>>>(new Map());
  const lastDrawnFrameRef = useRef<number | null>(null);
  const requestedFrameRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const resolved = useMemo(() => normalizeVideo(video), [video]);
  const fps = useMemo(() => video_fps(resolved), [resolved]);
  const sourceFrameCount = useMemo(() => video_frame_count(resolved), [resolved]);
  const rawDurationFrames = useMemo(() => video_length(resolved), [resolved]);
  const durationFrames = Math.max(0, rawDurationFrames - trimStartFrames - trimEndFrames);
  useProvideClipDuration(durationFrames);

  const currentFrame = useCurrentFrame();
  const currentFrameRef = useRef(currentFrame);
  const waitCanvasIdRef = useRef(`video-${Math.random().toString(36).slice(2)}`);
  const visible = useClipActive()
  const clipStart = useClipStart()

  useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  // Keep canvas pixels in sync with its CSS size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        // Hidden clips report 0x0; keep previous size to avoid requesting 1x1 frames.
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      const nextWidth = Math.max(1, Math.round(rect.width * dpr));
      const nextHeight = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
      canvasSizeRef.current = { width: canvas.width, height: canvas.height };
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
    for (const waiter of waitersRef.current.values()) {
      waiter.reject(reason);
    }
    waitersRef.current.clear();
  }, []);

  const createOrGetFramePromise = useCallback((target: number) => {
    const exists = waitersRef.current.get(target)
    if (exists) {
      return exists
    }

    const manual = createManualPromise()
    manual.promise.finally(() => {
      waitersRef.current.delete(target)
    })
    trackPending(manual)
    waitersRef.current.set(target, manual)
    return manual
  }, [])

  const resolveWaiters = useCallback((projectFrame: number) => {
    const prev = lastDrawnFrameRef.current ?? -Infinity;
    if (projectFrame > prev) {
      lastDrawnFrameRef.current = projectFrame;
    }
    createOrGetFramePromise(projectFrame).resolve()
  }, []);

  const sendPlaybackFrameRequest = useCallback((playbackFrame: number) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const req = {
      video: resolved.path,
      width: canvasSizeRef.current.width > 1 ? canvasSizeRef.current.width : PROJECT_SETTINGS.width,
      height: canvasSizeRef.current.height > 1 ? canvasSizeRef.current.height : PROJECT_SETTINGS.height,
      frame: playbackFrame,
    };

    ws.send(JSON.stringify(req));
  }, [resolved.path]);

  const sendFrameRequest = useCallback(
    (frame: number) => {
      const hasDuration = durationFrames > 0;
      const maxFrame = hasDuration ? Math.max(0, durationFrames - 1) : undefined;
      const clampedFrame =
        maxFrame !== undefined ? Math.min(Math.max(frame, 0), maxFrame) : Math.max(frame, 0);

      const sourceStart =
        fps > 0
          ? Math.floor((trimStartFrames * fps) / PROJECT_SETTINGS.fps)
          : trimStartFrames;
      const sourceTrimEnd =
        fps > 0
          ? Math.floor((trimEndFrames * fps) / PROJECT_SETTINGS.fps)
          : trimEndFrames;
      const estimatedSourceFrames =
        fps > 0
          ? Math.max(0, Math.round((rawDurationFrames * fps) / PROJECT_SETTINGS.fps))
          : rawDurationFrames;
      const sourceTotalFrames = sourceFrameCount > 0 ? sourceFrameCount : estimatedSourceFrames;
      const sourceEnd = Math.max(sourceStart, sourceTotalFrames - sourceTrimEnd - 1);

      requestedFrameRef.current = clampedFrame;

      const playbackFrameRaw =
        fps > 0
          ? Math.floor(((clampedFrame + trimStartFrames) * fps) / PROJECT_SETTINGS.fps)
          : clampedFrame + trimStartFrames;
      const playbackFrame = Math.min(Math.max(playbackFrameRaw, sourceStart), sourceEnd);

      const alreadyDrawn =
        lastDrawnFrameRef.current != null && lastDrawnFrameRef.current >= clampedFrame;
      const existingPending = pendingMapRef.current.get(playbackFrame);
      if (alreadyDrawn && !existingPending) return;

      if (existingPending) {
        if (existingPending.projectFrame !== clampedFrame) {
          existingPending.projectFrame = clampedFrame;
        }
      } else {
        const manual = createManualPromise();
        trackPending(manual);
        pendingMapRef.current.set(playbackFrame, { manual, projectFrame: clampedFrame });
      }

      sendPlaybackFrameRequest(playbackFrame);
    },
    [
      durationFrames,
      fps,
      rawDurationFrames,
      sendPlaybackFrameRequest,
      sourceFrameCount,
      trimEndFrames,
      trimStartFrames,
    ],
  );

  useEffect(() => {
    if (!visible) {
      return;
    }

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

    let disposed = false;

    const scheduleReconnect = () => {
      if (disposed) return;
      if (reconnectTimerRef.current != null) return;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        if (disposed) return;
        connect();
      }, 300);
    };

    const handleDisconnect = (reason: unknown, shouldRetry: boolean) => {
      wsRef.current = null;
      if (shouldRetry) {
        if (!disposed) {
          scheduleReconnect();
        }
      } else {
        rejectPendingRequests(reason);
      }
    };

    const connect = () => {
      if (wsRef.current) return;
      const socket = new WebSocket("ws://localhost:3000/ws");
      socket.binaryType = "arraybuffer";
      wsRef.current = socket;

      socket.onopen = () => {
        if (disposed) return;
        clearReconnectTimer();
        const pendingEntries = Array.from(pendingMapRef.current.keys());
        if (pendingEntries.length > 0) {
          for (const frameIndex of pendingEntries) {
            sendPlaybackFrameRequest(frameIndex);
          }
        }
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
          Math.max(
            0,
            Math.round((frameIndex * PROJECT_SETTINGS.fps) / Math.max(1, fps || PROJECT_SETTINGS.fps)) -
              trimStartFrames,
          );

        if (pending) {
          pendingMapRef.current.delete(frameIndex);
          pending.manual.resolve();
        }

        resolveWaiters(projectFrame);
      };

      socket.onerror = (event) => {
        if (disposed) return;
        handleDisconnect(event, true);
      };

      socket.onclose = () => {
        if (disposed) return;
        handleDisconnect(new Error("socket closed"), true);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      rejectPendingRequests(new Error("component unmounted"));
    };
  }, [rejectPendingRequests, resolveWaiters, sendFrameRequest, sendPlaybackFrameRequest, visible]);

  useEffect(() => {
    if (visible) return;
    // Re-entering a clip must not reuse stale last-drawn markers.
    lastDrawnFrameRef.current = null;
    requestedFrameRef.current = null;
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    sendFrameRequest(currentFrame);
  }, [currentFrame, sendFrameRequest, visible]);


  useEffect(() => {
    const waitCanvasFrame = async (frame: number) => {
      if (!visible) {
        return
      }
      const startOffset = clipStart ?? 0
      const relativeFrame = frame - startOffset
      if (relativeFrame < 0 || durationFrames <= 0) {
        return
      }
      const maxFrame = Math.max(0, durationFrames - 1)
      const clampedFrame = Math.min(Math.max(relativeFrame, 0), maxFrame)
      const lastDrawn = lastDrawnFrameRef.current
      if (lastDrawn != null && lastDrawn >= clampedFrame) {
        return
      }
      await createOrGetFramePromise(clampedFrame).promise
    }

    const id = waitCanvasIdRef.current
    if (visible) {
      waitCanvasFrameCallbacks.set(id, waitCanvasFrame)
    } else {
      waitCanvasFrameCallbacks.delete(id)
    }
    updateGlobalWaitCanvasFrame()

    return () => {
      waitCanvasFrameCallbacks.delete(id)
      updateGlobalWaitCanvasFrame()
    }
  }, [clipStart, createOrGetFramePromise, durationFrames, visible])

  const baseStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    border: "0px",
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
