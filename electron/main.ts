import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  type MenuItemConstructorOptions,
} from "electron";
import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { WebSocket, WebSocketServer } from "ws";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import puppeteer from "puppeteer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const useDevServer = process.env.VITE_DEV_SERVER_URL !== undefined;
const runMode = process.env.FRAMESCRIPT_RUN_MODE ?? (useDevServer ? "dev" : "bin");
const useBinaries = runMode !== "dev";
const APP_NAME = "FrameScript";
const PROJECT_ROOT = path.join(process.cwd(), "project");
const WORKSPACE_ROOT = process.cwd();
let lspServer: WebSocketServer | null = null;
let lspPort: number | null = null;
let projectWatchers: Map<string, fs.FSWatcher> | null = null;
let projectWatchRefreshTimer: NodeJS.Timeout | null = null;
let projectWatchInitPromise: Promise<void> | null = null;
const unsavedChangesByWebContents = new Map<number, boolean>();
let allowWindowClose = false;

if (app.name !== APP_NAME) {
  app.setName(APP_NAME);
}

const resolveBundledBinaryPath = (installer: unknown) => {
  const candidate =
    (installer as { path?: string; default?: { path?: string } } | undefined)?.path ??
    (installer as { default?: { path?: string } } | undefined)?.default?.path;
  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate;
  }
  return null;
};

const resolvePuppeteerExecutablePath = () => {
  try {
    if (typeof puppeteer?.executablePath === "function") {
      return puppeteer.executablePath();
    }
  } catch (_error) {
    // ignore
  }
  return null;
};

function getBundledBinaryEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const ffmpegPath = process.env.FRAMESCRIPT_FFMPEG_PATH ?? resolveBundledBinaryPath(ffmpegInstaller);
  const ffprobePath = process.env.FRAMESCRIPT_FFPROBE_PATH ?? resolveBundledBinaryPath(ffprobeInstaller);
  const chromiumPath =
    process.env.FRAMESCRIPT_CHROMIUM_PATH ??
    process.env.PUPPETEER_EXECUTABLE_PATH ??
    resolvePuppeteerExecutablePath();
  if (ffmpegPath) {
    env.FRAMESCRIPT_FFMPEG_PATH = ffmpegPath;
  }
  if (ffprobePath) {
    env.FRAMESCRIPT_FFPROBE_PATH = ffprobePath;
  }
  if (chromiumPath) {
    env.FRAMESCRIPT_CHROMIUM_PATH = chromiumPath;
  }
  return env;
}

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let backendHealthyPromise: Promise<void> | null = null;
let renderSettingsWindow: BrowserWindow | null = null;
let renderProgressWindow: BrowserWindow | null = null;
let renderChild: ChildProcess | null = null;

type RenderStartPayload = {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  workers: number;
  encode: "H264" | "H265";
  preset: string;
};

function getPlatformKey() {
  if (process.platform === "linux" && process.arch === "x64") return "linux-x86_64";
  if (process.platform === "win32" && process.arch === "x64") return "win32-x86_64";
  if (process.platform === "darwin" && process.arch === "arm64") return "macos-arm64";
  return `${process.platform}-${process.arch}`;
}

function getBackendBinaryPath() {
  const platformKey = getPlatformKey();
  const binName = process.platform === "win32" ? "backend.exe" : "backend";

  const candidates = [
    process.env.FRAMESCRIPT_BACKEND_BIN,
    path.join(process.cwd(), "bin", platformKey, binName),
    path.join(process.resourcesPath, "bin", platformKey, binName),
    path.join(process.resourcesPath, "backend", binName),
  ].filter(Boolean) as string[];

  const found = candidates.find((p) => fs.existsSync(p));
  return { platformKey, binName, candidates, path: found ?? candidates[0] };
}

function getRenderPageUrl() {
  if (process.env.RENDER_PAGE_URL) return process.env.RENDER_PAGE_URL;
  if (useDevServer) {
    return process.env.RENDER_DEV_SERVER_URL ?? "http://localhost:5174/render";
  }
  const htmlPath = path.join(process.cwd(), "dist-render", "render.html");
  return pathToFileURL(htmlPath).toString();
}

function getRenderOutputPath() {
  return process.env.FRAMESCRIPT_OUTPUT_PATH ?? path.join(process.cwd(), "output.mp4");
}

function getRenderOutputDisplayPath() {
  const absolute = getRenderOutputPath();
  const relative = path.relative(process.cwd(), absolute);
  const display = relative || absolute;
  return display.split(path.sep).join("/");
}

function startBackend(): Promise<void> {
  if (backendProcess) {
    return Promise.resolve();
  }

  if (!useBinaries) {
    const backendCwd = path.join(process.cwd(), "backend");

    backendProcess = spawn("cargo", ["run"], {
      cwd: backendCwd,
      stdio: "pipe",
      env: {
        ...process.env,
        ...getBundledBinaryEnv(),
      },
    });

    console.log("[backend] spawn: cargo run (dev)");

  } else {
    const info = getBackendBinaryPath();
    if (!fs.existsSync(info.path)) {
      throw new Error(
        `Backend binary not found for platform "${info.platformKey}". Tried:\n` +
          info.candidates.map((p) => `- ${p}`).join("\n"),
      );
    }

    backendProcess = spawn(info.path, [], {
      stdio: "pipe",
      env: {
        ...process.env,
        ...getBundledBinaryEnv(),
      },
    });

    console.log("[backend] spawn:", info.path);
  }

  backendProcess.stdout?.on("data", (data) => {
    console.log("[backend stdout]", data.toString());
  });

  backendProcess.stderr?.on("data", (data) => {
    console.error("[backend stderr]", data.toString());
  });

  backendProcess.on("exit", (code, signal) => {
    console.log(`[backend exited] code=${code} signal=${signal}`);
    backendProcess = null;
  });

  return Promise.resolve();
}

function stopBackend() {
  if (backendProcess && !backendProcess.killed) {
    console.log("[backend] kill");
    backendProcess.kill();
  }
}

async function waitForHealthz(): Promise<void> {
  if (backendHealthyPromise) return backendHealthyPromise;

  const healthUrl = "http://127.0.0.1:3000/healthz";
  backendHealthyPromise = new Promise((resolve, reject) => {
    const started = Date.now();
    const timeoutMs = 15_000;
    const intervalMs = 300;

    const timer = setInterval(() => {
      fetch(healthUrl)
        .then((res) => {
          if (res.ok) {
            clearInterval(timer);
            resolve();
          }
        })
        .catch(() => {
          // ignore and retry
        });

      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error("healthz timeout"));
      }
    }, intervalMs);
  });

  return backendHealthyPromise;
}

function resolveRenderSettingsUrl() {
  if (useDevServer && process.env.VITE_DEV_SERVER_URL) {
    return `${process.env.VITE_DEV_SERVER_URL}/#/render-settings`;
  }

  const indexPath = path.join(__dirname, "../dist/index.html");
  return { file: indexPath, hash: "render-settings" } as const;
}

function resolveRenderProgressUrl() {
  const outputParam = encodeURIComponent(getRenderOutputDisplayPath());
  if (useDevServer && process.env.VITE_DEV_SERVER_URL) {
    return `${process.env.VITE_DEV_SERVER_URL}/#/render-progress?output=${outputParam}`;
  }

  const indexPath = path.join(__dirname, "../dist/index.html");
  return { file: indexPath, hash: `render-progress?output=${outputParam}` } as const;
}

function resolveRenderPreloadPath() {
  const candidates = [
    path.join(__dirname, "render-settings-preload.js"),
    path.join(process.cwd(), "dist-electron", "render-settings-preload.js"),
    path.join(process.cwd(), "render-settings-preload.js"),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    console.warn("[render preload] file not found. Tried:", candidates);
    return candidates[0];
  }
  return found;
}

function resolveMainPreloadPath() {
  const candidates = [
    path.join(__dirname, "preload.cjs"),
    path.join(__dirname, "preload.js"),
    path.join(process.cwd(), "dist-electron", "preload.cjs"),
    path.join(process.cwd(), "dist-electron", "preload.js"),
    path.join(process.cwd(), "preload.cjs"),
    path.join(process.cwd(), "preload.js"),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    console.warn("[main preload] file not found. Tried:", candidates);
    return candidates[0];
  }
  return found;
}

function getRenderBinaryInfo() {
  const platformKey = getPlatformKey();
  const binName = process.platform === "win32" ? "render.exe" : "render";
  const candidates = [
    process.env.FRAMESCRIPT_RENDER_BIN,
    path.join(process.cwd(), "bin", platformKey, binName),
    path.join(process.resourcesPath, "bin", platformKey, binName),
    path.join(process.resourcesPath, "render", binName),
  ].filter(Boolean) as string[];
  const binPath = candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
  return { platformKey, binName, binPath, candidates };
}

const resolveProjectPath = (filePath: string) => {
  let normalized = filePath;
  if (normalized.startsWith("file:")) {
    try {
      normalized = fileURLToPath(normalized);
    } catch {
      normalized = normalized.replace(/^file:(\/\/)?/, "");
    }
  }
  const candidate = path.isAbsolute(normalized)
    ? normalized
    : path.join(PROJECT_ROOT, normalized);
  const resolved = path.resolve(candidate);
  const root = path.resolve(PROJECT_ROOT);
  if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
    return resolved;
  }
  throw new Error("Path is outside project root");
};

const resolveWorkspacePath = (filePath: string) => {
  let normalized = filePath;
  if (normalized.startsWith("file:")) {
    try {
      normalized = fileURLToPath(normalized);
    } catch {
      normalized = normalized.replace(/^file:(\/\/)?/, "");
    }
  }
  const candidate = path.isAbsolute(normalized)
    ? normalized
    : path.join(WORKSPACE_ROOT, normalized);
  const resolved = path.resolve(candidate);
  const root = path.resolve(WORKSPACE_ROOT);
  if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) {
    return resolved;
  }
  throw new Error("Path is outside workspace root");
};

const resolveTypescriptLanguageServerPath = () => {
  const binName = process.platform === "win32" ? "typescript-language-server.cmd" : "typescript-language-server";
  const localBin = path.join(process.cwd(), "node_modules", ".bin", binName);
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  return binName;
};

const startLspServer = async () => {
  if (lspServer && lspPort) return lspPort;

  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolve();
    };
    server.once("error", handleError);
    server.once("listening", handleListening);
  });

  const address = server.address();
  if (typeof address === "object" && address) {
    lspPort = address.port;
  } else {
    server.close();
    throw new Error("Failed to start LSP server");
  }

  server.on("connection", (socket) => {
    const command = resolveTypescriptLanguageServerPath();
    const args = ["--stdio"];

    console.log("[lsp] spawn:", command, args.join(" "));

    const proc = spawn(command, args, {
      cwd: process.cwd(),
      stdio: "pipe",
      env: {
        ...process.env,
      },
    });

    if (!proc.stdout || !proc.stdin) {
      console.error("[lsp] stdio unavailable for language server");
      socket.close();
      return;
    }

    if (proc.stderr) {
      proc.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        if (text.trim().length > 0) {
          console.error("[lsp stderr]", text.trim());
        }
      });
    }

    let buffer = Buffer.alloc(0);
    let contentLength = 0;

    const tryParse = () => {
      while (true) {
        if (contentLength === 0) {
          const headerEnd = buffer.indexOf("\r\n\r\n");
          if (headerEnd === -1) return;
          const header = buffer.subarray(0, headerEnd).toString("utf8");
          const match = /Content-Length:\s*(\d+)/i.exec(header);
          if (!match) {
            buffer = buffer.subarray(headerEnd + 4);
            continue;
          }
          contentLength = Number.parseInt(match[1], 10);
          buffer = buffer.subarray(headerEnd + 4);
        }
        if (buffer.length < contentLength) return;
        const message = buffer.subarray(0, contentLength);
        buffer = buffer.subarray(contentLength);
        contentLength = 0;
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(message.toString("utf8"));
        }
      }
    };

    proc.stdout.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      tryParse();
    });

    const handleSocketMessage = (data: ArrayBuffer | Buffer | string) => {
      try {
        const payload =
          typeof data === "string"
            ? data
            : Buffer.isBuffer(data)
            ? data.toString("utf8")
            : Buffer.from(data).toString("utf8");
        if (!payload) return;
        const message = `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`;
        proc.stdin.write(message, "utf8");
      } catch (error) {
        console.error("[lsp] failed to send message", error);
      }
    };

    socket.on("message", handleSocketMessage);

    const cleanup = () => {
      try {
        socket.removeAllListeners();
      } catch {
        // ignore
      }
      try {
        proc.kill();
      } catch {
        // ignore
      }
    };

    socket.on("close", cleanup);
    socket.on("error", cleanup);
    proc.on("exit", (code, signal) => {
      console.log(`[lsp] server exited code=${code ?? "null"} signal=${signal ?? "null"}`);
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    });
    proc.on("error", (error) => {
      console.error("[lsp] server process error", error);
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    });
  });

  lspServer = server;
  return lspPort;
};

const stopLspServer = () => {
  if (lspServer) {
    lspServer.close();
    lspServer = null;
  }
  lspPort = null;
};

const collectProjectFiles = async (dir: string, output: string[]) => {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectProjectFiles(fullPath, output);
    } else if (entry.isFile()) {
      if (fullPath.endsWith(".tsx") || fullPath.endsWith(".ts")) {
        output.push(fullPath);
      }
    }
  }
};

const collectProjectDirectories = async (dir: string, output: string[]) => {
  output.push(dir);
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory()) continue;
    await collectProjectDirectories(path.join(dir, entry.name), output);
  }
};

const broadcastProjectChange = (payload: { type: string; path: string }) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("editor:projectFilesChanged", payload);
  }
};

const scheduleProjectWatchRefresh = () => {
  if (projectWatchRefreshTimer) return;
  projectWatchRefreshTimer = setTimeout(() => {
    projectWatchRefreshTimer = null;
    void refreshProjectWatchers();
  }, 300);
};

const refreshProjectWatchers = async () => {
  if (!projectWatchers) projectWatchers = new Map();
  const directories: string[] = [];
  try {
    await collectProjectDirectories(PROJECT_ROOT, directories);
  } catch (error) {
    console.warn("[watcher] failed to scan project directories", error);
    return;
  }
  const desired = new Set(directories);

  for (const dirPath of desired) {
    if (projectWatchers.has(dirPath)) continue;
    try {
      const watcher = fs.watch(dirPath, (eventType, filename: string | Buffer | null) => {
        const name = typeof filename === "string" ? filename : filename?.toString();
        const changedPath = name ? path.join(dirPath, name) : dirPath;
        broadcastProjectChange({ type: eventType, path: changedPath });
        scheduleProjectWatchRefresh();
      });
      watcher.on("error", (error) => {
        console.warn("[watcher] error", error);
        scheduleProjectWatchRefresh();
      });
      projectWatchers.set(dirPath, watcher);
    } catch (error) {
      console.warn("[watcher] failed to watch directory", dirPath, error);
    }
  }

  for (const [dirPath, watcher] of projectWatchers) {
    if (desired.has(dirPath)) continue;
    watcher.close();
    projectWatchers.delete(dirPath);
  }
};

const startProjectWatchers = async () => {
  if (projectWatchInitPromise) return projectWatchInitPromise;
  projectWatchInitPromise = refreshProjectWatchers().catch((error) => {
    projectWatchInitPromise = null;
    throw error;
  });
  return projectWatchInitPromise;
};

const stopProjectWatchers = () => {
  if (projectWatchRefreshTimer) {
    clearTimeout(projectWatchRefreshTimer);
    projectWatchRefreshTimer = null;
  }
  if (projectWatchers) {
    for (const watcher of projectWatchers.values()) {
      watcher.close();
    }
    projectWatchers.clear();
  }
  projectWatchers = null;
  projectWatchInitPromise = null;
};

const getJsxAttributeName = (name: ts.JsxAttributeName) => {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isJsxNamespacedName(name)) {
    return `${name.namespace.text}:${name.name.text}`;
  }
  return null;
};

const extractClipLabel = (attr: ts.JsxAttribute) => {
  if (getJsxAttributeName(attr.name) !== "label") return null;
  const init = attr.initializer;
  if (!init) return null;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const expr = init.expression;
    if (ts.isStringLiteral(expr)) return expr.text;
    if (ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
    if (ts.isTemplateExpression(expr) && expr.templateSpans.length === 0) {
      return expr.head.text;
    }
  }
  return null;
};

const isClipTag = (tag: ts.JsxTagNameExpression) => {
  if (ts.isIdentifier(tag)) return tag.text === "Clip";
  if (ts.isPropertyAccessExpression(tag)) return tag.name.text === "Clip";
  return false;
};

const findClipLabelInSource = (source: ts.SourceFile, label: string) => {
  const matches: Array<{ filePath: string; line: number; column: number }> = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const opening = node.openingElement;
      if (isClipTag(opening.tagName)) {
        for (const prop of opening.attributes.properties) {
          if (!ts.isJsxAttribute(prop)) continue;
          const value = extractClipLabel(prop);
          if (value === label) {
            const pos = prop.getStart(source);
            const { line, character } = source.getLineAndCharacterOfPosition(pos);
            matches.push({
              filePath: source.fileName,
              line: line + 1,
              column: character + 1,
            });
          }
        }
      }
    } else if (ts.isJsxSelfClosingElement(node)) {
      if (isClipTag(node.tagName)) {
        for (const prop of node.attributes.properties) {
          if (!ts.isJsxAttribute(prop)) continue;
          const value = extractClipLabel(prop);
          if (value === label) {
            const pos = prop.getStart(source);
            const { line, character } = source.getLineAndCharacterOfPosition(pos);
            matches.push({
              filePath: source.fileName,
              line: line + 1,
              column: character + 1,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return matches;
};

const findClipLabelInProject = async (label: string) => {
  if (!label) return [];
  const files: string[] = [];
  await collectProjectFiles(PROJECT_ROOT, files);
  const matches: Array<{ filePath: string; line: number; column: number }> = [];
  for (const filePath of files) {
    const content = await fs.promises.readFile(filePath, "utf8");
    const source = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    matches.push(...findClipLabelInSource(source, label));
  }
  return matches.sort((a, b) => {
    if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
    return a.line - b.line;
  });
};

function startRenderProcess(payload: RenderStartPayload) {
  const argsString = `${payload.width}:${payload.height}:${payload.fps}:${payload.totalFrames}:${payload.workers}:${payload.encode}:${payload.preset}`;

  if (renderChild && !renderChild.killed) {
    console.log("[render] terminating previous render process");
    renderChild.kill();
    renderChild = null;
  }

  if (!useBinaries) {
    const renderCwd = path.join(process.cwd(), "render");
    try {
      renderChild = spawn("cargo", ["run", "--", argsString], {
        cwd: renderCwd,
        env: {
          ...process.env,
          ...getBundledBinaryEnv(),
          RENDER_PAGE_URL: getRenderPageUrl(),
          RENDER_OUTPUT_PATH: getRenderOutputPath(),
        },
        stdio: "inherit",
      });
    } catch (error) {
      console.error("[render] failed to spawn cargo run", error);
      throw error;
    }
    renderChild.on("error", (error) => {
      console.error("[render] process error", error);
    });
    renderChild.on("exit", (code, signal) => {
      console.log(`[render] exited code=${code} signal=${signal}`);
      renderChild = null;
    });
    console.log("[render] spawn (dev): cargo run --", argsString, "cwd=", renderCwd);
    return { cmd: `render (cargo run) -- ${argsString}`, pid: renderChild?.pid };
  } else {
    const { binPath, platformKey } = getRenderBinaryInfo();

    if (!fs.existsSync(binPath)) {
      const info = getRenderBinaryInfo();
      throw new Error(
        `Render binary not found for platform "${platformKey}". Tried:\n` +
          info.candidates.map((p) => `- ${p}`).join("\n"),
      );
    }

    try {
      renderChild = spawn(binPath, [argsString], {
        env: {
          ...process.env,
          ...getBundledBinaryEnv(),
          RENDER_PAGE_URL: getRenderPageUrl(),
          RENDER_OUTPUT_PATH: getRenderOutputPath(),
        },
        stdio: "inherit",
      });
    } catch (error) {
      console.error("[render] failed to spawn render binary", error);
      throw error;
    }

    renderChild.on("error", (error) => {
      console.error("[render] process error", error);
    });

    renderChild.on("exit", (code, signal) => {
      console.log(`[render] exited code=${code} signal=${signal}`);
      renderChild = null;
    });

    console.log("[render] spawn:", binPath, argsString);
    return { cmd: `${binPath} ${argsString}`, pid: renderChild.pid };
  }

  // unreachable
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: "#0b1221",
    webPreferences: {
      preload: resolveMainPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (useDevServer && process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    //mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, "../dist/index.html");
    await mainWindow.loadFile(indexPath);
  }

  allowWindowClose = false;
  const webContentsId = mainWindow.webContents.id;
  mainWindow.on("close", (event) => {
    if (allowWindowClose) return;
    const hasUnsaved = unsavedChangesByWebContents.get(webContentsId);
    if (!hasUnsaved) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow as BrowserWindow, {
      type: "warning",
      buttons: ["Cancel", "Discard Changes"],
      defaultId: 0,
      cancelId: 0,
      title: "Unsaved Changes",
      message: "You have unsaved changes. Discard them and close?",
      detail: "Any unsaved edits will be lost.",
    });
    if (choice === 1) {
      allowWindowClose = true;
      unsavedChangesByWebContents.set(webContentsId, false);
      mainWindow?.destroy();
    }
  });

  mainWindow.on("closed", () => {
    unsavedChangesByWebContents.delete(webContentsId);
    mainWindow = null;
  });
}

function createRenderSettingsWindow() {
  if (renderSettingsWindow && !renderSettingsWindow.isDestroyed()) {
    renderSettingsWindow.focus();
    return;
  }

  renderSettingsWindow = new BrowserWindow({
    width: 640,
    height: 750,
    resizable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: "#0b1221",
    title: "Render Settings",
    parent: mainWindow ?? undefined,
    modal: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: resolveRenderPreloadPath(),
      sandbox: false,
    },
  });
  renderSettingsWindow.setMenu(null);
  renderSettingsWindow.setMenuBarVisibility(false);

  const target = resolveRenderSettingsUrl();
  if (typeof target === "string") {
    void renderSettingsWindow.loadURL(target);
  } else {
    void renderSettingsWindow.loadFile(target.file, { hash: target.hash });
  }

  renderSettingsWindow.on("closed", () => {
    renderSettingsWindow = null;
  });
}

function createRenderProgressWindow() {
  if (renderProgressWindow && !renderProgressWindow.isDestroyed()) {
    renderProgressWindow.focus();
    return;
  }

  renderProgressWindow = new BrowserWindow({
    width: 420,
    height: 300,
    resizable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: "#0b1221",
    title: "Render Progress",
    parent: mainWindow ?? undefined,
    modal: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: resolveRenderPreloadPath(),
    },
  });
  renderProgressWindow.setMenu(null);
  renderProgressWindow.setMenuBarVisibility(false);

  const target = resolveRenderProgressUrl();
  if (typeof target === "string") {
    void renderProgressWindow.loadURL(target);
  } else {
    void renderProgressWindow.loadFile(target.file, { hash: target.hash });
  }

  renderProgressWindow.on("closed", () => {
    renderProgressWindow = null;
  });
}

function setupRenderIpc() {
  ipcMain.handle("render:getPlatform", () => {
    if (!useBinaries) {
      const renderDir = path.join(process.cwd(), "render");
      return {
        platform: "dev",
        binPath: renderDir,
        binName: "cargo run",
        isDev: true,
      };
    }
    const info = getRenderBinaryInfo();
    return { platform: info.platformKey, binPath: info.binPath, binName: info.binName, isDev: false };
  });

  ipcMain.handle("render:getOutputPath", () => {
    return { path: getRenderOutputPath(), displayPath: getRenderOutputDisplayPath() };
  });

  ipcMain.handle("render:openProgress", () => {
    createRenderProgressWindow();
  });

  ipcMain.handle("render:start", (_event, payload: RenderStartPayload) => {
    const width = Number(payload.width) || 0;
    const height = Number(payload.height) || 0;
    const fps = Number(payload.fps) || 0;
    const totalFrames = Number(payload.totalFrames) || 0;
    const workers = Math.max(1, Number(payload.workers) || 1);
    const encode = payload.encode === "H265" ? "H265" : "H264";
    const preset = payload.preset || "medium";

    if (width <= 0 || height <= 0 || fps <= 0 || totalFrames <= 0) {
      throw new Error("Invalid render payload");
    }

    return startRenderProcess({
      width,
      height,
      fps,
      totalFrames,
      workers,
      encode,
      preset,
    });
  });
}

function setupEditorIpc() {
  ipcMain.handle("editor:readFile", async (_event, filePath: string) => {
    const resolved = resolveProjectPath(filePath);
    const content = await fs.promises.readFile(resolved, "utf8");
    return { path: resolved, content };
  });

  ipcMain.handle("editor:readFileOptional", async (_event, filePath: string) => {
    const resolved = resolveWorkspacePath(filePath);
    try {
      const content = await fs.promises.readFile(resolved, "utf8");
      return { path: resolved, content };
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  });

  ipcMain.handle("editor:writeFile", async (_event, payload: { filePath: string; content: string }) => {
    const resolved = resolveProjectPath(payload.filePath);
    await fs.promises.writeFile(resolved, payload.content, "utf8");
  });

  ipcMain.handle("editor:stat", async (_event, filePath: string) => {
    const resolved = resolveProjectPath(filePath);
    const stats = await fs.promises.stat(resolved);
    return {
      type: stats.isDirectory() ? "directory" : "file",
      ctime: stats.ctimeMs,
      mtime: stats.mtimeMs,
      size: stats.size,
    };
  });

  ipcMain.handle("editor:statOptional", async (_event, filePath: string) => {
    const resolved = resolveWorkspacePath(filePath);
    try {
      const stats = await fs.promises.stat(resolved);
      return {
        type: stats.isDirectory() ? "directory" : "file",
        ctime: stats.ctimeMs,
        mtime: stats.mtimeMs,
        size: stats.size,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  });

  ipcMain.handle("editor:readdir", async (_event, filePath: string) => {
    const resolved = resolveProjectPath(filePath);
    const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
    }));
  });

  ipcMain.handle("editor:readdirOptional", async (_event, filePath: string) => {
    const resolved = resolveWorkspacePath(filePath);
    try {
      const entries = await fs.promises.readdir(resolved, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
      }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  });

  ipcMain.handle("editor:mkdir", async (_event, filePath: string) => {
    const resolved = resolveProjectPath(filePath);
    await fs.promises.mkdir(resolved, { recursive: true });
  });

  ipcMain.handle("editor:delete", async (_event, filePath: string) => {
    const resolved = resolveProjectPath(filePath);
    await fs.promises.rm(resolved, { recursive: true, force: true });
  });

  ipcMain.handle("editor:rename", async (_event, payload: { from: string; to: string }) => {
    const fromPath = resolveProjectPath(payload.from);
    const toPath = resolveProjectPath(payload.to);
    await fs.promises.rename(fromPath, toPath);
  });

  ipcMain.handle("editor:findClipLabel", async (_event, label: string) => {
    return findClipLabelInProject(label);
  });

  ipcMain.handle("editor:getLspPort", async () => {
    return startLspServer();
  });

  ipcMain.handle("editor:getProjectRoot", () => {
    return WORKSPACE_ROOT;
  });

  ipcMain.on("editor:setUnsavedChanges", (event, hasUnsaved: boolean) => {
    unsavedChangesByWebContents.set(event.sender.id, Boolean(hasUnsaved));
  });

  ipcMain.handle("editor:watchProject", async () => {
    await startProjectWatchers();
  });

  ipcMain.handle("editor:unwatchProject", () => {
    stopProjectWatchers();
  });
}

function setupMenu() {
  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: APP_NAME,
      submenu: [
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  template.push(
    {
      label: "File",
      submenu: [
        {
          label: "Render…",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            createRenderSettingsWindow();
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Debug",
      submenu: [
        {
          label: "DevTools",
          accelerator: "CmdOrCtrl+Alt+I",
          click: () => {
            const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
            if (!win) return;
            win.webContents.openDevTools({ mode: "detach" });
          },
        },
        {
          label: "Toggle DevTools",
          accelerator: "CmdOrCtrl+Shift+I",
          click: () => {
            const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
            if (!win) return;
            win.webContents.toggleDevTools();
          },
        },
        { type: "separator" },
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
            win?.webContents.reload();
          },
        },
        {
          label: "Force Reload",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => {
            const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
            win?.webContents.reloadIgnoringCache();
          },
        },
      ],
    },
  );

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.commandLine.appendSwitch("enable-unsafe-webgpu");
/*
if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-features", "Vulkan");
}
*/

app.whenReady().then(async () => {
  await startBackend();
  await waitForHealthz();
  setupRenderIpc();
  setupEditorIpc();
  await createWindow();
  setupMenu();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("before-quit", () => {
  stopBackend();
  stopLspServer();
  stopProjectWatchers();
  if (renderChild && !renderChild.killed) {
    renderChild.kill();
  }
});

app.on("window-all-closed", () => {
  // if (process.platform !== "darwin") {
  app.quit();
  // }
});
