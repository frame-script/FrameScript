import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // For headless render in non-dev mode, we load `dist-render/render.html` via `file://`.
  // Assets must be relative for the file protocol.
  base: command === "build" ? "./" : "/",
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: "dist-render",
    rollupOptions: {
      input: {
        render: resolve(__dirname, "render.html"),
      },
    },
  },
}));
