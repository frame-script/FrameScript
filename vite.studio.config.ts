import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  return {
    plugins: [react()],
    // For Electron `loadFile()` in non-dev mode, assets must be relative.
    base: command === "build" ? "./" : "/",
    server: {
      hmr: {
        overlay: true,
      },
    },
  }
})
