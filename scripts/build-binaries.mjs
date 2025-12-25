import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const platformKey = (() => {
  if (process.platform === "linux" && process.arch === "x64") return "linux-x86_64";
  if (process.platform === "win32" && process.arch === "x64") return "win32-x86_64";
  if (process.platform === "darwin" && process.arch === "arm64") return "macos-arm64";
  return `${process.platform}-${process.arch}`;
})();

const exe = process.platform === "win32" ? ".exe" : "";

const run = (cwd, args) => {
  const result = spawnSync(args[0], args.slice(1), { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const copy = (src, dst) => {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  if (process.platform !== "win32") {
    fs.chmodSync(dst, 0o755);
  }
};

const backendDir = path.join(root, "backend");
const renderDir = path.join(root, "render");

run(backendDir, ["cargo", "build", "--release"]);
run(renderDir, ["cargo", "build", "--release"]);

const backendSrc = path.join(backendDir, "target", "release", `backend${exe}`);
const renderSrc = path.join(renderDir, "target", "release", `render${exe}`);

if (!fs.existsSync(backendSrc)) {
  console.error("[build:binaries] backend binary not found:", backendSrc);
  process.exit(1);
}
if (!fs.existsSync(renderSrc)) {
  console.error("[build:binaries] render binary not found:", renderSrc);
  process.exit(1);
}

const outDir = path.join(root, "bin", platformKey);
copy(backendSrc, path.join(outDir, `backend${exe}`));
copy(renderSrc, path.join(outDir, `render${exe}`));

console.log(`[build:binaries] done: bin/${platformKey}/backend${exe}, bin/${platformKey}/render${exe}`);

