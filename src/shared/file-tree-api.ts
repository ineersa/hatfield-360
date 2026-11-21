/** One entry of a listed folder. A symlink is listed as what it points at. */
export type DirectoryEntry = {
  name: string
  path: string
  kind: 'directory' | 'file'
  symlink: boolean
  /** Ignored by git; always false in plain folders. */
  ignored: boolean
}

export type DirectoryListing =
  | { path: string; status: 'ok'; entries: DirectoryEntry[] }
  | { path: string; status: 'error'; message: string }

export const FILE_TREE_CHANNELS = {
  list: 'file-tree:list',
  watch: 'file-tree:watch',
  changed: 'file-tree:changed',
  copyPath: 'file-tree:copy-path',
  reveal: 'file-tree:reveal'
} as const

/** How Copy Path writes a path: as is, or from the root folder it is under. */
export type PathForm = 'absolute' | 'relative'

export type FileTreeApi = {
  /** Lists a folder inside the workspace's folders or worktrees: folders first, then files, by name. */
  listDirectory: (path: string) => Promise<DirectoryListing>
  /** The folders to watch, replacing the previous set; folders outside the workspace are skipped. */
  watchDirectories: (paths: string[]) => Promise<void>
  /** A watched folder changed (an entry or the ignore rules over it); list it again. */
  subscribeDirectoryChanges: (callback: (paths: string[]) => void) => () => void
  /** Puts a path inside the workspace on the clipboard; `relative` is from its root folder. */
  copyPath: (path: string, form: PathForm) => Promise<void>
  /** Shows a file or folder inside the workspace in the system file manager. */
  revealPath: (path: string) => Promise<void>
}
