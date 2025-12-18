import type { CSSProperties } from "react";
import { useEffect, useId, useMemo, useRef } from "react";
import { useCurrentFrame, useSetGlobalCurrentFrame } from "../frame";
import { PROJECT_SETTINGS } from "../../../project/project";
import { useIsPlaying, useIsRender } from "../studio-state";
import { useClipActive, useClipRange, useClipStart, useProvideClipDuration } from "../clip";
import { registerAudioSegmentGlobal, unregisterAudioSegmentGlobal } from "../audio-plan";
import { VideoCanvasRender } from "./video-render";
import type { Trim } from "../trim";
import { resolveTrimFrames } from "../trim";

export type Video = {
  path: string
}

export type VideoProps = {
  video: Video | string
  style?: CSSProperties
  trim?: Trim
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

export type VideoResolvedTrimProps = {
  trimStartFrames: number
  trimEndFrames: number
}

export const Video = ({ video, style, trim }: VideoProps) => {
  const isRender = useIsRender()
  const id = useId()
  const clipRange = useClipRange()
  const resolvedVideo = useMemo(() => normalizeVideo(video), [video])
  const rawDurationFrames = useMemo(() => video_length(resolvedVideo), [resolvedVideo])
  const { trimStartFrames, trimEndFrames } = useMemo(
    () =>
      resolveTrimFrames({
        rawDurationFrames,
        trim,
      }),
    [rawDurationFrames, trim],
  )

  useEffect(() => {
    if (!clipRange) return

    const projectStartFrame = clipRange.start
    const clipDurationFrames = Math.max(0, clipRange.end - clipRange.start + 1)
    const availableFrames = Math.max(0, rawDurationFrames - trimStartFrames - trimEndFrames)
    const durationFrames = Math.min(clipDurationFrames, availableFrames)
    if (durationFrames <= 0) return

    registerAudioSegmentGlobal({
      id,
      source: { kind: "video", path: resolvedVideo.path },
      projectStartFrame,
      sourceStartFrame: trimStartFrames,
      durationFrames,
    })

    return () => {
      unregisterAudioSegmentGlobal(id)
    }
  }, [clipRange, id, rawDurationFrames, resolvedVideo.path, trimEndFrames, trimStartFrames])

  if (isRender) {
    return (
      <VideoCanvasRender
        video={video}
        style={style}
        trimStartFrames={trimStartFrames}
        trimEndFrames={trimEndFrames}
      />
    )
  } else {
    return (
      <VideoCanvas
        video={video}
        style={style}
        trimStartFrames={trimStartFrames}
        trimEndFrames={trimEndFrames}
      />
    )
  }
}

type VideoCanvasProps = Omit<VideoProps, "trim"> & VideoResolvedTrimProps

const VideoCanvas = ({ video, style, trimStartFrames = 0, trimEndFrames = 0 }: VideoCanvasProps) => {
  const resolvedVideo = useMemo(() => normalizeVideo(video), [video])
  const elementRef = useRef<HTMLVideoElement | null>(null);
  const currentFrame = useCurrentFrame()
  const isPlaying = useIsPlaying()
  const isVisible = useClipActive()
  const playingFlag = useRef(false)
  const pendingSeek = useRef<number | null>(null)
  const rawDuration = useMemo(() => video_length(resolvedVideo), [resolvedVideo])
  const durationFrames = Math.max(0, rawDuration - trimStartFrames - trimEndFrames)
  useProvideClipDuration(durationFrames)

  useEffect(() => {
    const el = elementRef.current
    if (!el || isPlaying) return

    const time = (currentFrame + trimStartFrames) / PROJECT_SETTINGS.fps
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
      const time = (currentFrame + trimStartFrames) / PROJECT_SETTINGS.fps
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
      const frame = Math.round(time * PROJECT_SETTINGS.fps) - trimStartFrames
      setGlobalCurrentFrame(Math.max(0, frame) + clipStart)
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
