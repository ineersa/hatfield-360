export const EDITOR_CHANNELS = {
  read: 'editor:read-file',
  write: 'editor:write-file',
  save: 'editor:save'
} as const

export type EditorApi = {
  /** Reads a text file inside the workspace's folders or worktrees. */
  readTextFile: (path: string) => Promise<string>
  /** Replaces a text file inside the workspace atomically, keeping its permissions. */
  writeTextFile: (path: string, contents: string) => Promise<void>
  /** File > Save was chosen; save the active editor tab. */
  subscribeSaveCommand: (callback: () => void) => () => void
}
