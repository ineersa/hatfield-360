import type { RecentConversation } from './recent-conversation'
import type { TerminalLayout } from './terminal-workspace-api'
import type { Notice } from './notice'

/** A project shows in the Projects panel and the file tree; a plain folder only in the file tree. */
export type WorkspaceFolderKind = 'project' | 'folder'

/** A folder in the open workspace, as the renderer sees it. */
export type WorkspaceFolder = {
  path: string
  name: string
  kind: WorkspaceFolderKind
  /** The folder no longer exists on disk; it stays listed until the user removes it. */
  missing: boolean
}

/** What a Recent entry opens: the default workspace, a saved workspace file, or a folder to add. */
type RecentKind = 'default' | 'workspace' | 'folder'

export type RecentTarget = { kind: RecentKind; path: string }

export type RecentEntry = RecentTarget & {
  name: string
  /** The file or folder no longer exists; opening it offers to remove it from Recent. */
  missing: boolean
  /** The workspace open in this window. */
  current: boolean
  /** Kept in Hatfield's own workspaces folder: always listed, so it can't be removed from Recent. */
  stored: boolean
}

export type WorkspaceView = {
  /** "Default Workspace" or the workspace file's name. */
  name: string
  /** The open workspace file, or null for the default workspace. */
  file: string | null
  folders: WorkspaceFolder[]
  terminalGeneration: number
  terminals?: TerminalLayout
  recentConversations?: RecentConversation[]
  /** Set when the workspace file can't be used (e.g. written by a newer app version); changes are refused. */
  problem: string | null
  /** Why the last workspace action started outside the window failed (File menu, reopening at launch). */
  notice: Notice | null
  /** The default workspace first, then workspace files (recent, then the rest of Hatfield's workspaces folder), then recent folders. */
  recent: RecentEntry[]
}

export const WORKSPACE_CHANNELS = {
  get: 'workspace:get',
  addFolder: 'workspace:add-folder',
  removeFolder: 'workspace:remove-folder',
  setFolderKind: 'workspace:set-folder-kind',
  openFile: 'workspace:open-file',
  openRecent: 'workspace:open-recent',
  removeRecent: 'workspace:remove-recent',
  changed: 'workspace:changed',
  removeConversation: 'workspace:remove-conversation',
  checkpointTerminals: 'workspace:checkpoint-terminals'
} as const

export type WorkspaceApi = {
  removeRecentConversation: (generation: number, key: string) => Promise<void>
  checkpointTerminals: (generation: number, layout: TerminalLayout) => Promise<void>
  getWorkspace: () => Promise<WorkspaceView>
  /** Opens the native folder picker in main and adds the chosen folder. */
  addWorkspaceFolder: () => Promise<void>
  removeWorkspaceFolder: (path: string) => Promise<void>
  /** Hide from Projects (`folder`) or Show in Projects (`project`). */
  setWorkspaceFolderKind: (path: string, kind: WorkspaceFolderKind) => Promise<void>
  /** Opens the native file picker in main and switches to the chosen workspace file. */
  openWorkspaceFile: () => Promise<void>
  /** Opens a Recent entry; main accepts only entries in its own Recent list. */
  openRecent: (target: RecentTarget) => Promise<void>
  removeRecent: (target: RecentTarget) => Promise<void>
  subscribeWorkspace: (callback: (workspace: WorkspaceView) => void) => () => void
}
