import { useCurrentFrame } from "./frame"

type ClipProps = {
  start: number
  end: number
  children: React.ReactNode
}

export const Clip = ({ start, end, children }: ClipProps) => {
  const currentFrame = useCurrentFrame()

  if (currentFrame < start || currentFrame >= end) {
    return null;
  }

  return <>{children}</>;
}
