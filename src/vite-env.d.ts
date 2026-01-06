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

type EditorClipMatch = {
  filePath: string;
  line: number;
  column?: number;
};

type EditorStat = {
  type: "file" | "directory";
  ctime: number;
  mtime: number;
  size: number;
};

type EditorDirEntry = {
  name: string;
  type: "file" | "directory";
};

interface Window {
  renderAPI?: {
    getPlatform: () => Promise<{ platform: string; binPath: string; binName: string; isDev?: boolean }>;
    getOutputPath: () => Promise<{ path: string; displayPath?: string }>;
    startRender: (payload: RenderStartPayload) => Promise<{ cmd: string; pid: number | undefined }>;
    openProgress: () => Promise<void>;
  };
  editorAPI?: {
    readFile: (filePath: string) => Promise<{ path: string; content: string }>;
    readFileOptional: (filePath: string) => Promise<{ path: string; content: string } | null>;
    writeFile: (filePath: string, content: string) => Promise<void>;
    stat: (filePath: string) => Promise<EditorStat>;
    statOptional: (filePath: string) => Promise<EditorStat | null>;
    readdir: (filePath: string) => Promise<EditorDirEntry[]>;
    readdirOptional: (filePath: string) => Promise<EditorDirEntry[] | null>;
    mkdir: (filePath: string) => Promise<void>;
    delete: (filePath: string) => Promise<void>;
    rename: (from: string, to: string) => Promise<void>;
    findClipLabel: (label: string) => Promise<EditorClipMatch[]>;
    getLspPort: () => Promise<number>;
    getProjectRoot: () => Promise<string>;
  };
}
