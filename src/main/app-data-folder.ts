import { app } from 'electron'
import { join } from 'node:path'

/**
 * Runs from the repo (`pnpm dev`, `pnpm start`) keep their own app data, so they never change the
 * installed app's settings and workspaces. An explicit `--user-data-dir` (E2E) wins.
 */
export function separateDevAppData(): void {
  if (app.isPackaged || app.commandLine.hasSwitch('user-data-dir')) return
  app.setPath('userData', join(app.getPath('appData'), `${app.getName()}-dev`))
}
