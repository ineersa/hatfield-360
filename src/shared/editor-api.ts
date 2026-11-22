export const EDITOR_CHANNELS = {
  read: 'editor:read-file',
  write: 'editor:write-file',
  release: 'editor:release-file',
  save: 'editor:save',
  setUnsaved: 'editor:set-unsaved',
  closeRequested: 'editor:close-requested',
  answerClose: 'editor:answer-close'
} as const

export type EditorApi = {
  /** Reads a text file inside the workspace's folders or worktrees. */
  readTextFile: (path: string) => Promise<string>
  /**
   * Replaces a text file atomically, keeping its permissions: one inside the workspace, or one this
   * page read and hasn't released, as long as the path still leads to the same file.
   */
  writeTextFile: (path: string, contents: string) => Promise<void>
  /** The editor no longer holds the file: outside the workspace, it can't be written any more. */
  releaseTextFile: (path: string) => Promise<void>
  /** File > Save was chosen; save the active editor tab. */
  subscribeSaveCommand: (callback: () => void) => () => void
  /** Whether any editor tab has unsaved changes; while it does, closing the window or quitting asks first. */
  setUnsavedChanges: (unsaved: boolean) => Promise<void>
  /** The window is closing or the app quitting with unsaved changes; answer with `answerCloseRequest`. */
  subscribeCloseRequest: (callback: () => void) => () => void
  /** Go on closing (the changes were saved or discarded), or cancel it. */
  answerCloseRequest: (proceed: boolean) => Promise<void>
}
