import { contextBridge, ipcRenderer } from "electron";

type RenderStartPayload = {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  workers: number;
  encode: "H264" | "H265";
  preset: string;
};

contextBridge.exposeInMainWorld("renderAPI", {
  getPlatform: () => ipcRenderer.invoke("render:getPlatform"),
  getOutputPath: () => ipcRenderer.invoke("render:getOutputPath"),
  startRender: (payload: RenderStartPayload) =>
    ipcRenderer.invoke("render:start", payload),
  openProgress: () => ipcRenderer.invoke("render:openProgress"),
});
