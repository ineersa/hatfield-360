import type { AgentApi } from './agent-api'
import type { ChatAgentApi } from './chat-agent-api'
import type { EditorApi } from './editor-api'
import type { FilesSessionApi } from './files-session-api'
import type { FileTreeApi } from './file-tree-api'
import type { KeybindingsApi } from './keybindings-api'
import type { LanguageServerApi } from './language-server-api'
import type { MemorySearchApi } from './memory-search-api'
import type { SearchApi } from './search-api'
import type { SettingsApi } from './settings-api'
import type { ShellLayoutApi } from './shell-layout-api'
import type { SourceControlApi } from './source-control-api'
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
  ChatAgentApi &
  AgentApi &
  MemorySearchApi &
  SettingsApi &
  KeybindingsApi &
  ShellLayoutApi &
  TerminalApi &
  WebLinkApi &
  WorktreeApi &
  SourceControlApi &
  FileTreeApi &
  SearchApi &
  EditorApi &
  FilesSessionApi &
  LanguageServerApi & {
    getAppInfo: () => Promise<AppInfo>
  }
