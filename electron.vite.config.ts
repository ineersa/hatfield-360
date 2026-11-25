import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    // Bundled, so the chat's MCP server and the ACP SDK share one copy of the MCP package: loaded
    // from node_modules, main's require() gets its CommonJS build and the SDK its ES module one.
    build: {
      externalizeDeps: {
        exclude: ['@agentclientprotocol/sdk', '@modelcontextprotocol/server', 'zod']
      }
    }
  },
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
