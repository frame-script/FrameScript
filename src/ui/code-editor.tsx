import { useCallback, useEffect, useRef, useState } from "react";
import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "@codingame/monaco-vscode-editor-api";
import type * as Monaco from "@codingame/monaco-vscode-editor-api";
import { MonacoLanguageClient } from "monaco-languageclient";
import { MonacoVscodeApiWrapper } from "monaco-languageclient/vscodeApiWrapper";
import { configureDefaultWorkerFactory } from "monaco-languageclient/workerFactory";
import { LogLevel } from "@codingame/monaco-vscode-api";
import { CloseAction, ErrorAction, State } from "vscode-languageclient/browser";
import { conf as tsConf, language as tsLanguage } from "monaco-editor/esm/vs/basic-languages/typescript/typescript";
import getFileServiceOverride, {
  registerFileSystemOverlay,
  FileChangeType,
  FileSystemProviderCapabilities,
  FileSystemProviderError,
  FileSystemProviderErrorCode,
  FileType,
  type IFileDeleteOptions,
  type IFileOverwriteOptions,
  type IFileSystemProviderWithFileReadWriteCapability,
  type IFileWriteOptions,
  type IStat,
  type IWatchOptions,
} from "@codingame/monaco-vscode-files-service-override";
import { Emitter, Event } from "@codingame/monaco-vscode-api/vscode/vs/base/common/event";
import { Disposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import type { URI } from "@codingame/monaco-vscode-api/vscode/vs/base/common/uri";
import { toSocket, WebSocketMessageReader, WebSocketMessageWriter } from "vscode-ws-jsonrpc";
import EditorWorker from "@codingame/monaco-vscode-editor-api/esm/vs/editor/editor.worker?worker";
import { useEditor } from "./editor-context";
import "monaco-editor/min/vs/editor/editor.main.css";

loader.config({ monaco });


interface CodeEditorProps {
  width?: number | string;
  onWidthChange?: (width: number) => void;
}

type FileResource = URI;

const decodeEscaped = (input: string) => {
  let result = "";
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch !== "\\") {
      result += ch;
      continue;
    }
    const next = input[i + 1];
    if (next == null) break;
    i += 1;
    switch (next) {
      case "n":
        result += "\n";
        break;
      case "r":
        result += "\r";
        break;
      case "t":
        result += "\t";
        break;
      case "b":
        result += "\b";
        break;
      case "f":
        result += "\f";
        break;
      case "v":
        result += "\v";
        break;
      case "0":
        result += "\0";
        break;
      case "\\":
        result += "\\";
        break;
      case "'":
        result += "'";
        break;
      case "\"":
        result += "\"";
        break;
      case "u": {
        const hex = input.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          result += String.fromCharCode(Number.parseInt(hex, 16));
          i += 4;
        } else {
          result += "u";
        }
        break;
      }
      case "x": {
        const hex = input.slice(i + 1, i + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          result += String.fromCharCode(Number.parseInt(hex, 16));
          i += 2;
        } else {
          result += "x";
        }
        break;
      }
      default:
        result += next;
        break;
    }
  }
  return result;
};

const extractExportDefaultString = (payload: string) => {
  const trimmed = payload.trimStart();
  if (!trimmed.startsWith("export default")) return null;
  let i = "export default".length;
  while (i < trimmed.length && /\s/.test(trimmed[i])) i += 1;
  const quote = trimmed[i];
  if (quote !== "'" && quote !== "\"") return null;
  i += 1;
  let raw = "";
  for (; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "\\") {
      raw += ch;
      if (i + 1 < trimmed.length) {
        raw += trimmed[i + 1];
        i += 1;
      }
      continue;
    }
    if (ch === quote) {
      return decodeEscaped(raw);
    }
    raw += ch;
  }
  return null;
};

const toFilePath = (filePath: string) => {
  if (!filePath.startsWith("file:")) return filePath;
  try {
    const url = new URL(filePath);
    return decodeURIComponent(url.pathname);
  } catch {
    return filePath.replace(/^file:(\/\/)?/, "");
  }
};

const resolveDisplayPath = (filePath: string) => {
  const raw = toFilePath(filePath);
  const normalized = raw.replace(/\\/g, "/");
  const marker = "/project/";
  const idx = normalized.lastIndexOf(marker);
  if (idx >= 0) {
    return normalized.slice(idx + 1);
  }
  return normalized;
};

const toFileUri = (filePath: string) => {
  if (filePath.startsWith("file://")) return filePath;
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    return `file://${normalized}`;
  }
  return `file:///${normalized}`;
};

const toResourcePath = (resource: FileResource) => {
  if (resource.scheme === "file" && "fsPath" in resource && resource.fsPath) {
    return resource.fsPath;
  }
  return resource.path ?? resource.toString();
};

export const CodeEditor = ({ width = 400, onWidthChange }: CodeEditorProps) => {
  const [code, setCode] = useState<string>("");
  const [currentFile, setCurrentFile] = useState<string>("project.tsx");
  const [isLoading, setIsLoading] = useState(true);
  const [isVscodeReady, setIsVscodeReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("@codingame/monaco-vscode-editor-api") | null>(null);
  const highlightRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const monacoConfiguredRef = useRef(false);
  const vscodeApiRef = useRef<MonacoVscodeApiWrapper | null>(null);
  const vscodeInitRef = useRef<Promise<void> | null>(null);
  const fileSystemReadyRef = useRef(false);
  const lspClientRef = useRef<MonacoLanguageClient | null>(null);
  const lspStartingRef = useRef(false);
  const resizerRef = useRef<HTMLDivElement>(null);
  const { registerEditor } = useEditor();
  const loadIdRef = useRef(0);
  const pendingJumpRef = useRef<number | null>(null);
  const currentFileRef = useRef<string>(currentFile);
  const openFileRef = useRef<((filePath: string, line?: number) => Promise<void>) | null>(null);

  useEffect(() => {
    currentFileRef.current = currentFile;
  }, [currentFile]);

  const readFile = useCallback(async (filePath: string) => {
    const rawPath = toFilePath(filePath);
    if (window.editorAPI?.readFileOptional) {
      const data = await window.editorAPI.readFileOptional(rawPath);
      if (data) return data;
      if (window.editorAPI.readFile) {
        return window.editorAPI.readFile(rawPath);
      }
      throw new Error("Failed to load file");
    }
    if (window.editorAPI?.readFile) {
      return window.editorAPI.readFile(rawPath);
    }
    const fetchText = async (url: string) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load project file: ${response.statusText}`);
      }
      return response.text();
    };
    let text = "";
    try {
      text = await fetchText(`/project/${rawPath}?raw`);
    } catch (_error) {
      text = await fetchText(`/project/${rawPath}`);
    }
    const extracted = extractExportDefaultString(text);
    return { path: filePath, content: extracted ?? text };
  }, []);

  const loadFile = useCallback(async (filePath: string) => {
    const loadId = loadIdRef.current + 1;
    loadIdRef.current = loadId;
    try {
      setIsLoading(true);
      setError(null);
      const { content, path } = await readFile(filePath);
      if (loadId !== loadIdRef.current) return;
      const fileUri = toFileUri(path);
      setCode(content);
      setCurrentFile(fileUri);
      setIsDirty(false);
    } catch (err) {
      if (loadId !== loadIdRef.current) return;
      console.error("Failed to load project file:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (loadId === loadIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [readFile]);

  const revealLine = useCallback((line: number) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    editor.revealLineInCenter(line, monaco.editor.ScrollType.Smooth);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();

    const collection = highlightRef.current;
    if (!collection) return;
    collection.set([
      {
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: "highlight-line",
          glyphMarginClassName: "highlight-glyph",
        },
      },
    ]);
    if (highlightTimerRef.current != null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      collection.set([]);
      highlightTimerRef.current = null;
    }, 2000);
  }, []);

const configureMonaco = useCallback((monaco: typeof import("@codingame/monaco-vscode-editor-api")) => {
  if (monacoConfiguredRef.current) return;
  monacoConfiguredRef.current = true;

    const globalScope = self as unknown as {
      MonacoEnvironment?: {
        getWorker: (moduleId: string, label: string) => Worker;
      };
    };

    const existingWorker = globalScope.MonacoEnvironment?.getWorker;
    globalScope.MonacoEnvironment = {
      ...(globalScope.MonacoEnvironment ?? {}),
      getWorker: (moduleId, label) => {
        if (existingWorker) {
          try {
            return existingWorker(moduleId, label);
          } catch {
            // ignore and fall back
          }
        }
        return new EditorWorker();
      },
    };

    const registered = new Set(monaco.languages.getLanguages().map((lang) => lang.id));
    if (!registered.has("typescript")) {
      monaco.languages.register({
        id: "typescript",
        extensions: [".ts"],
        aliases: ["TypeScript", "ts"],
      });
    }
    if (!registered.has("typescriptreact")) {
      monaco.languages.register({
        id: "typescriptreact",
        extensions: [".tsx"],
        aliases: ["TypeScript React", "tsx"],
      });
    }
    monaco.languages.setMonarchTokensProvider("typescript", tsLanguage);
    monaco.languages.setLanguageConfiguration("typescript", tsConf);
    monaco.languages.setMonarchTokensProvider("typescriptreact", tsLanguage);
    monaco.languages.setLanguageConfiguration("typescriptreact", tsConf);
  }, []);

  const ensureFileSystemProvider = useCallback(() => {
    if (fileSystemReadyRef.current) return;
    fileSystemReadyRef.current = true;

    const editorApi = window.editorAPI;
    if (!editorApi?.statOptional || !editorApi.readdirOptional || !editorApi.readFileOptional) {
      console.warn("Editor API file system handlers are unavailable.");
      return;
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder("utf-8");
    const changeEmitter = new Emitter<readonly { type: FileChangeType; resource: FileResource }[]>();

    const provider = {
      capabilities:
        FileSystemProviderCapabilities.FileReadWrite |
        FileSystemProviderCapabilities.PathCaseSensitive,
      onDidChangeCapabilities: Event.None,
      onDidChangeFile: changeEmitter.event,
      watch: (_resource: FileResource, _opts: IWatchOptions) => Disposable.None,
      stat: async (resource: FileResource): Promise<IStat> => {
        try {
          const info = await editorApi.statOptional(toResourcePath(resource));
          if (!info) {
            throw FileSystemProviderError.create(
              "Not found",
              FileSystemProviderErrorCode.FileNotFound,
            );
          }
          const type = info.type === "directory" ? FileType.Directory : FileType.File;
          return {
            type,
            ctime: info.ctime,
            mtime: info.mtime,
            size: info.size,
          };
        } catch (error) {
          throw FileSystemProviderError.create(
            error instanceof Error ? error : String(error),
            FileSystemProviderErrorCode.FileNotFound,
          );
        }
      },
      readdir: async (resource: FileResource) => {
        try {
          const entries = await editorApi.readdirOptional(toResourcePath(resource));
          if (!entries) {
            throw FileSystemProviderError.create(
              "Not found",
              FileSystemProviderErrorCode.FileNotFound,
            );
          }
          return entries.map((entry) => [
            entry.name,
            entry.type === "directory" ? FileType.Directory : FileType.File,
          ]);
        } catch (error) {
          throw FileSystemProviderError.create(
            error instanceof Error ? error : String(error),
            FileSystemProviderErrorCode.FileNotFound,
          );
        }
      },
      readFile: async (resource: FileResource) => {
        try {
          const data = await editorApi.readFileOptional(toResourcePath(resource));
          if (!data) {
            throw FileSystemProviderError.create(
              "Not found",
              FileSystemProviderErrorCode.FileNotFound,
            );
          }
          return encoder.encode(data.content);
        } catch (error) {
          throw FileSystemProviderError.create(
            error instanceof Error ? error : String(error),
            FileSystemProviderErrorCode.FileNotFound,
          );
        }
      },
      writeFile: async (resource: FileResource, content: Uint8Array, _opts: IFileWriteOptions) => {
        const text = decoder.decode(content);
        await editorApi.writeFile(toResourcePath(resource), text);
        changeEmitter.fire([{ type: FileChangeType.UPDATED, resource }]);
      },
      mkdir: async (resource: FileResource) => {
        if (!editorApi.mkdir) return;
        await editorApi.mkdir(toResourcePath(resource));
        changeEmitter.fire([{ type: FileChangeType.ADDED, resource }]);
      },
      delete: async (resource: FileResource, _opts: IFileDeleteOptions) => {
        if (!editorApi.delete) return;
        await editorApi.delete(toResourcePath(resource));
        changeEmitter.fire([{ type: FileChangeType.DELETED, resource }]);
      },
      rename: async (from: FileResource, to: FileResource, _opts: IFileOverwriteOptions) => {
        if (!editorApi.rename) return;
        await editorApi.rename(toResourcePath(from), toResourcePath(to));
        changeEmitter.fire([{ type: FileChangeType.DELETED, resource: from }]);
        changeEmitter.fire([{ type: FileChangeType.ADDED, resource: to }]);
      },
    } satisfies IFileSystemProviderWithFileReadWriteCapability;

    registerFileSystemOverlay(1, provider);
  }, []);

  const ensureVscodeApi = useCallback(async (workspacePath: string) => {
    if (vscodeInitRef.current) return vscodeInitRef.current;

    ensureFileSystemProvider();
    const workspaceUri = monaco.Uri.file(workspacePath);
    const wrapper = new MonacoVscodeApiWrapper({
      $type: "classic",
      logLevel: LogLevel.Off,
      viewsConfig: {
        $type: "EditorService",
        openEditorFunc: async (modelRef, options) => {
          const target = modelRef?.object?.textEditorModel?.uri?.toString();
          if (target) {
            const selection = (options as { selection?: { startLineNumber?: number } } | undefined)
              ?.selection;
            const line = selection?.startLineNumber;
            await openFileRef.current?.(target, line);
          }
          return editorRef.current ?? undefined;
        },
      },
      serviceOverrides: {
        ...getFileServiceOverride(),
      },
      workspaceConfig: {
        workspaceProvider: {
          trusted: true,
          workspace: { folderUri: workspaceUri },
          async open() {
            return true;
          },
        },
      },
      monacoWorkerFactory: (logger) => {
        configureDefaultWorkerFactory(logger);
      },
    });

    vscodeApiRef.current = wrapper;
    vscodeInitRef.current = wrapper.start({ caller: "CodeEditor" }).catch((error) => {
      vscodeInitRef.current = null;
      throw error;
    });
    return vscodeInitRef.current;
  }, [ensureFileSystemProvider]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      if (!window.editorAPI?.getProjectRoot) {
        if (!cancelled) setIsVscodeReady(true);
        return;
      }
      try {
        const rootPath = await window.editorAPI.getProjectRoot();
        await ensureVscodeApi(rootPath);
      } catch (error) {
        console.error("Failed to initialize editor services", error);
      } finally {
        if (!cancelled) setIsVscodeReady(true);
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [ensureVscodeApi]);

  const startLspClient = useCallback(async (monacoApi: typeof import("@codingame/monaco-vscode-editor-api")) => {
    if (lspClientRef.current || lspStartingRef.current) return;
    if (!window.editorAPI?.getLspPort || !window.editorAPI?.getProjectRoot) {
      return;
    }

    lspStartingRef.current = true;
    try {
      const [port, rootPath] = await Promise.all([
        window.editorAPI.getLspPort(),
        window.editorAPI.getProjectRoot(),
      ]);
      await ensureVscodeApi(rootPath);
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);

      const openClient = async () => {
        try {
          const iSocket = toSocket(socket);
          const reader = new WebSocketMessageReader(iSocket);
          const writer = new WebSocketMessageWriter(iSocket);
          const rootUri = toFileUri(rootPath);
          const languageClient = new MonacoLanguageClient({
            name: "TypeScript Language Server",
            clientOptions: {
              documentSelector: [
                { language: "typescript", scheme: "file" },
                { language: "typescriptreact", scheme: "file" },
              ],
              workspaceFolder: {
                uri: monaco.Uri.parse(rootUri),
                name: "frame-script",
                index: 0,
              },
              errorHandler: {
                error: () => ({ action: ErrorAction.Continue }),
                closed: () => ({ action: CloseAction.DoNotRestart }),
              },
            },
            messageTransports: { reader, writer },
          });

          lspClientRef.current = languageClient;
          await languageClient.start();
          lspStartingRef.current = false;
        } catch (error) {
          console.error("Failed to start LSP client", error);
          const client = lspClientRef.current;
          if (client) {
            if (client.state === State.Running) {
              void client.stop().catch(() => { });
            }
          }
          lspClientRef.current = null;
          lspStartingRef.current = false;
        }
      };

      if (socket.readyState === WebSocket.OPEN) {
        void openClient();
      } else {
        socket.addEventListener("open", () => void openClient(), { once: true });
      }

      socket.addEventListener("error", (event) => {
        console.error("LSP socket error", event);
        lspStartingRef.current = false;
      });

      socket.addEventListener("close", () => {
        const client = lspClientRef.current;
        if (client) {
          if (client.state === State.Running) {
            void client.stop().catch(() => { });
          }
        }
        lspClientRef.current = null;
        lspStartingRef.current = false;
      });
    } catch (error) {
      console.error("Failed to start LSP client", error);
      lspStartingRef.current = false;
    }
  }, [ensureVscodeApi]);

  useEffect(() => {
    return () => {
      const client = lspClientRef.current;
      if (client) {
        void client.stop().catch(() => { });
      }
      lspClientRef.current = null;
    };
  }, []);

  const jumpToMatch = useCallback((needle: string) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;
    const candidates = [
      `label="${needle}"`,
      `label='${needle}'`,
      `"${needle}"`,
      `'${needle}'`,
    ];
    for (const candidate of candidates) {
      const matches = model.findMatches(candidate, false, false, true, null, false);
      if (matches.length > 0) {
        const range = matches[0].range;
        editor.revealRangeInCenter(range, monaco.editor.ScrollType.Smooth);
        editor.setPosition({ lineNumber: range.startLineNumber, column: range.startColumn });
        editor.focus();
        revealLine(range.startLineNumber);
        return;
      }
    }
  }, [revealLine]);

  const openFile = useCallback(async (filePath: string, line?: number) => {
    if (!filePath) return;
    const fileUri = toFileUri(filePath);
    if (currentFileRef.current === fileUri) {
      if (line != null) revealLine(line);
      return;
    }
    pendingJumpRef.current = line ?? null;
    await loadFile(fileUri);
  }, [loadFile, revealLine]);

  useEffect(() => {
    openFileRef.current = openFile;
  }, [openFile]);

  // Load project.tsx content
  useEffect(() => {
    void loadFile("project.tsx");
  }, [loadFile]);

  const handleEditorDidMount = (
    editor: Monaco.editor.IStandaloneCodeEditor,
    monaco: typeof import("@codingame/monaco-vscode-editor-api"),
  ) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    highlightRef.current = editor.createDecorationsCollection();
    void startLspClient(monaco);

    // Add Ctrl+S keybinding
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSave();
    });

    registerEditor({ openFile, jumpToLine: revealLine, jumpToMatch });
  };

  useEffect(() => {
    if (pendingJumpRef.current == null) return;
    const line = pendingJumpRef.current;
    pendingJumpRef.current = null;
    revealLine(line);
  }, [code, currentFile, revealLine]);

  const handleSave = async () => {
    if (!code) return;
    const targetPath = toFilePath(currentFileRef.current);

    try {
      if (window.editorAPI?.writeFile) {
        await window.editorAPI.writeFile(targetPath, code);
      } else {
        const response = await fetch("/api/save-project", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ code }),
        });

        if (!response.ok) {
          throw new Error("Failed to save project file");
        }
      }
      setIsDirty(false);

      // Trigger hot reload
      if (import.meta.hot) {
        import.meta.hot.invalidate();
      }
    } catch (err) {
      console.error("Failed to save project file:", err);
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  };

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = typeof width === "number" ? width : 400;

    const handleMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.max(300, Math.min(1200, startWidth + delta));
      onWidthChange?.(newWidth);
    };

    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const displayPath = resolveDisplayPath(currentFile);
  const languageId = displayPath.endsWith(".tsx") ? "typescriptreact" : "typescript";

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        position: "relative",
        width: "100%",
        flex: 1,
        minWidth: 0,
      }}
    >
      {/* Resizer */}
      <div
        ref={resizerRef}
        onPointerDown={startResize}
        style={{
          width: 6,
          cursor: "col-resize",
          background: "linear-gradient(180deg, #1f2937, #111827)",
          borderRadius: 4,
          flexShrink: 0,
          zIndex: 10,
        }}
      />

      {/* Editor Container */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          background: "#1e1e1e",
          borderRadius: 8,
          overflow: "hidden",
          minWidth: 0,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "8px 16px",
            background: "#252526",
            borderBottom: "1px solid #3e3e42",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#cccccc", fontSize: 14, fontWeight: 500 }}>
              {displayPath}
            </span>
            {isDirty ? (
              <span style={{ color: "#fbbf24", fontSize: 11 }}>(unsaved)</span>
            ) : null}
            {error && (
              <span style={{ color: "#f48771", fontSize: 12 }}>({error})</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleSave}
              disabled={isLoading}
              style={{
                padding: "4px 12px",
                background: "#0e639c",
                color: "#ffffff",
                border: "none",
                borderRadius: 4,
                cursor: isLoading ? "not-allowed" : "pointer",
                fontSize: 12,
                fontWeight: 500,
                opacity: isLoading ? 0.5 : 1,
              }}
            >
              {isLoading ? "Loading..." : "Save (Ctrl+S)"}
            </button>
          </div>
        </div>

        {/* Highlight styles */}
        <style>{`
          .highlight-line {
            background-color: rgba(255, 255, 0, 0.2);
            animation: fadeOut 2s ease-in-out;
          }
          .highlight-glyph {
            background-color: #ffeb3b;
          }
          @keyframes fadeOut {
            0% { background-color: rgba(255, 255, 0, 0.3); }
            100% { background-color: rgba(255, 255, 0, 0); }
          }
        `}</style>

        {/* Editor */}
        <div style={{ flex: 1, minHeight: 0 }}>
          {isLoading || !isVscodeReady ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "#cccccc",
              }}
            >
              Loading editor...
            </div>
          ) : (
            <Editor
              height="100%"
              language={languageId}
              value={code}
              onChange={(value) => {
                setCode(value || "");
                setIsDirty(true);
              }}
              beforeMount={configureMonaco}
              onMount={handleEditorDidMount}
              path={currentFile}
              theme="vs-dark"
              options={{
                minimap: { enabled: true },
                fontSize: 14,
                lineNumbers: "on",
                roundedSelection: false,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                wordWrap: "on",
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};
