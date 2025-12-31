import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  type MenuItemConstructorOptions,
} from "electron";
import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import * as ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import * as ffprobeInstaller from "@ffprobe-installer/ffprobe";
import puppeteer from "puppeteer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const useDevServer = process.env.VITE_DEV_SERVER_URL !== undefined;
const runMode = process.env.FRAMESCRIPT_RUN_MODE ?? (useDevServer ? "dev" : "bin");
const useBinaries = runMode !== "dev";
const APP_NAME = "FrameScript";

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
      // preload: path.join(__dirname, "preload.js"),
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

  mainWindow.on("closed", () => {
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
    height: 550,
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
  await createWindow();
  setupRenderIpc();
  setupMenu();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("before-quit", () => {
  stopBackend();
  if (renderChild && !renderChild.killed) {
    renderChild.kill();
  }
});

app.on("window-all-closed", () => {
  // if (process.platform !== "darwin") {
  app.quit();
  // }
});
