import type { CSSProperties } from "react";
import { useMemo, useRef } from "react";
import { useCurrentFrame } from "../lib/frame";
import { PROJECT_SETTINGS } from "../../project/project";
import { useIsPlaying } from "../StudioApp";
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

  if (elementRef.current && !isPlaying) {
    const time = currentFrame / PROJECT_SETTINGS.fps
    elementRef.current.currentTime = time
  }

  const src = useMemo(() => {
    const url = new URL("http://localhost:3000/video");
    url.searchParams.set("path", video);
    return url.toString();
  }, [video]);

  if (elementRef.current) {
    elementRef.current.loop = false
  }

  const baseStyle: CSSProperties = {
    width: 640,
    height: 360,
    border: "1px solid #444",
    backgroundColor: "#000",
  };

  if (elementRef.current && isPlaying && isVisible) {
    elementRef.current.play()
  } else {
    elementRef.current?.pause()
  }

  return (
    <video
      ref={elementRef}
      src={src}
      style={style ? { ...baseStyle, ...style } : baseStyle}
    />
  );
};
