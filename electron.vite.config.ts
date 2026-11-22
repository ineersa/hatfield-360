import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: { '@': resolve(import.meta.dirname, 'src/renderer/src') }
    },
    // VS Code's extensions fetch their grammars and manifests; the CSP refuses them as inlined data: URLs.
    build: { assetsInlineLimit: 0 },
    plugins: [react(), tailwindcss()]
  }
})
