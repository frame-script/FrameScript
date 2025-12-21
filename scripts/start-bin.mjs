import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const electronBin = (() => {
  const base = path.join(root, "node_modules", ".bin");
  if (process.platform === "win32") return path.join(base, "electron.cmd");
  return path.join(base, "electron");
})();

const mainPath = path.join(root, "dist-electron", "main.js");

if (!fs.existsSync(electronBin)) {
  console.error("[start:bin] electron not found:", electronBin);
  process.exit(1);
}
if (!fs.existsSync(mainPath)) {
  console.error("[start:bin] dist-electron/main.js not found. Run: npm run build:all");
  process.exit(1);
}

const env = { ...process.env };
delete env.VITE_DEV_SERVER_URL;
env.NODE_ENV = "production";
env.FRAMESCRIPT_RUN_MODE = "bin";

const child = spawn(electronBin, [mainPath], {
  stdio: "inherit",
  env,
});

child.on("exit", (code) => process.exit(code ?? 0));

