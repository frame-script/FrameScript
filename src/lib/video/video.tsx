import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef } from "react";
import { useCurrentFrame, useSetGlobalCurrentFrame } from "../frame";
import { PROJECT_SETTINGS } from "../../../project/project";
import { useIsPlaying, useIsRender } from "../../StudioApp";
import { useClipActive, useClipStart, useProvideClipDuration } from "../clip";
import { VideoCanvasRender } from "./video-render";

export type Video = {
  path: string
}

export type VideoProps = {
  video: Video | string
  style?: CSSProperties
}

export const normalizeVideo = (video: Video | string): Video => {
  if (typeof video === "string") return { path: video }
  return video
}

const buildVideoUrl = (video: Video) => {
  const url = new URL("http://localhost:3000/video");
  url.searchParams.set("path", video.path);
  return url.toString();
}

const buildMetaUrl = (video: Video) => {
  const url = new URL("http://localhost:3000/video/meta");
  url.searchParams.set("path", video.path);
  return url.toString();
}

const videoLengthCache = new Map<string, number>()

export const video_length = (video: Video | string): number => {
  const resolved = normalizeVideo(video)

  if (videoLengthCache.has(resolved.path)) {
    return videoLengthCache.get(resolved.path)!
  }

  try {
    const xhr = new XMLHttpRequest()
    xhr.open("GET", buildMetaUrl(resolved), false) // 同期リクエストで初期ロード用途
    xhr.send()

    if (xhr.status >= 200 && xhr.status < 300) {
      const payload = JSON.parse(xhr.responseText) as { duration_ms?: number, fps?: number }
      const seconds = typeof payload.duration_ms === "number"
        ? Math.max(0, payload.duration_ms) / 1000
        : 0
      const frames = Math.round(seconds * PROJECT_SETTINGS.fps)
      videoLengthCache.set(resolved.path, frames)
      return frames
    }
  } catch (error) {
    console.error("video_length(): failed to fetch metadata", error)
  }

  videoLengthCache.set(resolved.path, 0)
  return 0
}

const videoFpsCache = new Map<string, number>()

export const video_fps = (video: Video | string): number => {
  const resolved = normalizeVideo(video)

  if (videoFpsCache.has(resolved.path)) {
    return videoFpsCache.get(resolved.path)!
  }

  try {
    const xhr = new XMLHttpRequest()
    xhr.open("GET", buildMetaUrl(resolved), false) // 同期リクエストで初期ロード用途
    xhr.send()

    if (xhr.status >= 200 && xhr.status < 300) {
      const payload = JSON.parse(xhr.responseText) as { duration_ms?: number, fps?: number }
      const fps = typeof payload.fps === "number" ? payload.fps : 0
      videoFpsCache.set(resolved.path, fps)
      return fps
    }
  } catch (error) {
    console.error("video_fps(): failed to fetch metadata", error)
  }

  videoFpsCache.set(resolved.path, 0)
  return 0
}

export const Video = ({ video, style }: VideoProps) => {
  const isRender = useIsRender()

  if (isRender) {
    return <VideoCanvasRender video={video} style={style} />
  } else {
    return <VideoCanvas video={video} style={style} />
  }
}

const VideoCanvas = ({ video, style }: VideoProps) => {
  const resolvedVideo = useMemo(() => normalizeVideo(video), [video])
  const elementRef = useRef<HTMLVideoElement | null>(null);
  const currentFrame = useCurrentFrame()
  const isPlaying = useIsPlaying()
  const isVisible = useClipActive()
  const playingFlag = useRef(false)
  const pendingSeek = useRef<number | null>(null)
  const durationFrames = useMemo(() => video_length(resolvedVideo), [resolvedVideo])
  useProvideClipDuration(durationFrames)

  useEffect(() => {
    const el = elementRef.current
    if (!el || isPlaying) return

    const time = currentFrame / PROJECT_SETTINGS.fps
    if (el.readyState >= HTMLMediaElement.HAVE_METADATA) {
      el.currentTime = time
      pendingSeek.current = null
    } else {
      pendingSeek.current = time
    }
  }, [currentFrame, isPlaying])

  const src = useMemo(() => {
    return buildVideoUrl(resolvedVideo);
  }, [resolvedVideo.path])

  const baseStyle: CSSProperties = {
    width: 640,
    height: 360,
    backgroundColor: "#000",
  }

  useEffect(() => {
    if (isPlaying) {
      const time = currentFrame / PROJECT_SETTINGS.fps
      const element = elementRef.current
      if (element) {
        element.currentTime = time
      }
    }
  }, [isVisible])

  useEffect(() => {
    const el = elementRef.current
    if (!el) return
    if (isPlaying && isVisible) {
      if (!playingFlag.current) {
        el.play()
        playingFlag.current = true
      }
    } else {
      el.pause()
      playingFlag.current = false
    }
  }, [isPlaying, isVisible])

  const setGlobalCurrentFrame = useSetGlobalCurrentFrame()
  const clipStart = useClipStart() ?? 0

  useEffect(() => {
    const el = elementRef.current
    if (!el || !isPlaying || !isVisible) return

    let raf: number | null = null
    const tick = () => {
      const time = el.currentTime
      const frame = Math.round(time * PROJECT_SETTINGS.fps)
      setGlobalCurrentFrame(frame + clipStart)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      if (raf != null) cancelAnimationFrame(raf)
    }
  }, [clipStart, isPlaying, isVisible, setGlobalCurrentFrame])

  return (
    <video
      ref={elementRef}
      src={src}
      onLoadedMetadata={() => {
        const el = elementRef.current
        if (!el) return
        if (pendingSeek.current != null) {
          el.currentTime = pendingSeek.current
          pendingSeek.current = null
        }
      }}
      onEnded={() => elementRef.current?.pause()}
      style={style ? { ...baseStyle, ...style } : baseStyle}
    />
  );
};
