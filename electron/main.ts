import { app, BrowserWindow } from "electron";
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcessWithoutNullStreams | null = null;
let backendHealthyPromise: Promise<void> | null = null;

function startBackend(): Promise<void> {
  if (backendProcess) {
    return Promise.resolve();
  }

  if (isDev) {
    const backendCwd = path.join(process.cwd(), "backend");

    backendProcess = spawn("cargo", ["run"], {
      cwd: backendCwd,
      stdio: "pipe",
    });

    console.log("[backend] spawn: cargo run (dev)");

  } else {
    const binaryName =
      process.platform === "win32" ? "backend.exe" : "backend";

    const backendPath = path.join(
      process.resourcesPath,
      "backend",
      binaryName,
    );

    backendProcess = spawn(backendPath, [], {
      stdio: "pipe",
    });

    console.log("[backend] spawn:", backendPath);
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

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
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

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("before-quit", () => {
  stopBackend();
});

app.on("window-all-closed", () => {
  // if (process.platform !== "darwin") {
  app.quit();
  // }
});
