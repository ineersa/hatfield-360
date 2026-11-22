/**
 * An open editor tab: its file, and its cursor, scroll and folds as the editor saved them (a JSON
 * object only the editor reads, or null).
 */
export type EditorTabSession = { path: string; view: unknown }

/** How a workspace's Files view was left: restored when the workspace opens again. */
export type FilesSession = {
  /** Folders expanded in the tree. */
  expanded: string[]
  hideIgnored: boolean
  /** In tab-bar order. */
  tabs: EditorTabSession[]
  activePath: string | null
}

export const EMPTY_FILES_SESSION: FilesSession = {
  expanded: [],
  hideIgnored: false,
  tabs: [],
  activePath: null
}

export const FILES_SESSION_CHANNELS = {
  get: 'files-session:get',
  save: 'files-session:save'
} as const

/** `workspace` is the workspace file, or null for the default workspace. */
export type FilesSessionApi = {
  getFilesSession: (workspace: string | null) => Promise<FilesSession>
  saveFilesSession: (workspace: string | null, session: FilesSession) => Promise<void>
}
