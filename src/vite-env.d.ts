/// <reference types="vite/client" />

type RenderStartPayload = {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  workers: number;
  encode: "H264" | "H265";
  preset: string;
};

interface Window {
  renderAPI?: {
    getPlatform: () => Promise<{ platform: string; binPath: string; binName: string; isDev?: boolean }>;
    getOutputPath: () => Promise<{ path: string; displayPath?: string }>;
    startRender: (payload: RenderStartPayload) => Promise<{ cmd: string; pid: number | undefined }>;
    openProgress: () => Promise<void>;
  };
}
