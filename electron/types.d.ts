declare module "@ffmpeg-installer/ffmpeg" {
  export const path: string
  const ffmpeg: { path: string }
  export default ffmpeg
}

declare module "@ffprobe-installer/ffprobe" {
  export const path: string
  const ffprobe: { path: string }
  export default ffprobe
}
