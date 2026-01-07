import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("editorAPI", {
  readFile: (filePath: string) => ipcRenderer.invoke("editor:readFile", filePath),
  readFileOptional: (filePath: string) => ipcRenderer.invoke("editor:readFileOptional", filePath),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke("editor:writeFile", { filePath, content }),
  stat: (filePath: string) => ipcRenderer.invoke("editor:stat", filePath),
  statOptional: (filePath: string) => ipcRenderer.invoke("editor:statOptional", filePath),
  readdir: (filePath: string) => ipcRenderer.invoke("editor:readdir", filePath),
  readdirOptional: (filePath: string) => ipcRenderer.invoke("editor:readdirOptional", filePath),
  mkdir: (filePath: string) => ipcRenderer.invoke("editor:mkdir", filePath),
  delete: (filePath: string) => ipcRenderer.invoke("editor:delete", filePath),
  rename: (from: string, to: string) => ipcRenderer.invoke("editor:rename", { from, to }),
  findClipLabel: (label: string) => ipcRenderer.invoke("editor:findClipLabel", label),
  getLspPort: () => ipcRenderer.invoke("editor:getLspPort"),
  getProjectRoot: () => ipcRenderer.invoke("editor:getProjectRoot"),
  setUnsavedChanges: (hasUnsaved: boolean) => ipcRenderer.send("editor:setUnsavedChanges", hasUnsaved),
  watchProject: () => ipcRenderer.invoke("editor:watchProject"),
  unwatchProject: () => ipcRenderer.invoke("editor:unwatchProject"),
  onProjectFilesChanged: (handler: (payload: { type: string; path: string }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { type: string; path: string }) => {
      handler(payload);
    };
    ipcRenderer.on("editor:projectFilesChanged", listener);
    return () => ipcRenderer.removeListener("editor:projectFilesChanged", listener);
  },
});
