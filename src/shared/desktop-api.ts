import type { SettingsApi } from './settings-api'
import type { ShellLayoutApi } from './shell-layout-api'
import type { TerminalApi } from './terminal-api'
import type { WorkspaceApi } from './workspace-api'

export type AppInfo = {
  name: string
  version: string
  platform: string
  electronVersion: string
}

export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info'
} as const

/** Everything the preload bridge exposes to the renderer as `window.desktop`. */
export type DesktopApi = WorkspaceApi &
  SettingsApi &
  ShellLayoutApi &
  TerminalApi & {
    getAppInfo: () => Promise<AppInfo>
  }
