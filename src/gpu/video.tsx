import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef } from "react";
import { useCurrentFrame } from "../lib/frame";
import { PROJECT_SETTINGS } from "../../project/project";
import { useIsPlaying, useIsPlayingStore } from "../StudioApp";
import { useClipActive } from "../lib/clip";

type VideoCanvasProps = {
  video: string;
  style?: CSSProperties;
}

export const VideoCanvas = ({ video, style }: VideoCanvasProps) => {
  const elementRef = useRef<HTMLVideoElement | null>(null);
  const currentFrame = useCurrentFrame()
  const isPlaying = useIsPlaying()
  const isVisible = useClipActive()
  const playingFlag = useRef(false)

  if (elementRef.current && !isPlaying) {
    const time = currentFrame / PROJECT_SETTINGS.fps
    elementRef.current.currentTime = time
  }

  const src = useMemo(() => {
    const url = new URL("http://localhost:3000/video");
    url.searchParams.set("path", video);
    return url.toString();
  }, [video]);

  const baseStyle: CSSProperties = {
    width: 640,
    height: 360,
    border: "1px solid #444",
    backgroundColor: "#000",
  };

  const isPlayingStore = useIsPlayingStore();

  useEffect(() => {
    const unsubscribe = isPlayingStore.subscribe((isPlaying) => {
      if (!isPlaying) {
        elementRef.current?.pause()
      }
    });
    return unsubscribe;
  }, [isPlayingStore]);

  if (elementRef.current && isPlaying && isVisible) {
    if (!playingFlag.current) {
      elementRef.current.play()
      playingFlag.current = true
    }
  } else {
    elementRef.current?.pause()
    playingFlag.current = false
  }

  return (
    <video
      ref={elementRef}
      src={src}
      onEnded={() => elementRef.current?.pause()}
      style={style ? { ...baseStyle, ...style } : baseStyle}
    />
  );
};
