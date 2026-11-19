/** A project folder in the open workspace, as the renderer sees it. */
export type WorkspaceFolder = {
  path: string
  name: string
  /** The folder no longer exists on disk; it stays listed until the user removes it. */
  missing: boolean
}

export type WorkspaceView = {
  folders: WorkspaceFolder[]
  /** Set when the workspace file can't be used (e.g. written by a newer app version); changes are refused. */
  problem: string | null
}

export const WORKSPACE_CHANNELS = {
  get: 'workspace:get',
  addFolder: 'workspace:add-folder',
  removeFolder: 'workspace:remove-folder',
  changed: 'workspace:changed'
} as const

export type WorkspaceApi = {
  getWorkspace: () => Promise<WorkspaceView>
  /** Opens the native folder picker in main and adds the chosen folder. */
  addWorkspaceFolder: () => Promise<void>
  removeWorkspaceFolder: (path: string) => Promise<void>
  subscribeWorkspace: (callback: (workspace: WorkspaceView) => void) => () => void
}
