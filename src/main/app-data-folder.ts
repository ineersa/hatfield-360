import { app } from 'electron'
import { join } from 'node:path'

// Vite serves every module over HTTP with a per-build `?v=` hash, so an uncapped cache fills with stale copies.
const devDiskCacheBytes = 100 * 1024 * 1024

/**
 * Runs from the repo (`pnpm dev`, `pnpm start`) keep their own app data, so they never change the
 * installed app's settings and workspaces. An explicit `--user-data-dir` (E2E) wins.
 */
export function separateDevAppData(): void {
  if (app.isPackaged) return
  app.commandLine.appendSwitch('disk-cache-size', String(devDiskCacheBytes))
  if (app.commandLine.hasSwitch('user-data-dir')) return
  app.setPath('userData', join(app.getPath('appData'), `${app.getName()}-dev`))
}
