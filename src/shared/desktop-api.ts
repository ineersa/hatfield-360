import type { AgentApi } from './agent-api'
import type { EditorApi } from './editor-api'
import type { FilesSessionApi } from './files-session-api'
import type { FileTreeApi } from './file-tree-api'
import type { SettingsApi } from './settings-api'
import type { ShellLayoutApi } from './shell-layout-api'
import type { TerminalApi } from './terminal-api'
import type { WebLinkApi } from './web-link-api'
import type { WorkspaceApi } from './workspace-api'
import type { WorktreeApi } from './worktree-api'

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
  AgentApi &
  SettingsApi &
  ShellLayoutApi &
  TerminalApi &
  WebLinkApi &
  WorktreeApi &
  FileTreeApi &
  EditorApi &
  FilesSessionApi & {
    getAppInfo: () => Promise<AppInfo>
  }
