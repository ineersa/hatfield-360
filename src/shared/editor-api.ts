/** What the editor reads of a file, in bytes: no more crosses from main. */
export const EDITOR_FILE_LIMITS = {
  /** Larger files open read-only, showing about this much of their start. */
  editable: 4 * 1024 * 1024,
  /** A NUL byte this early marks a binary file. */
  sniff: 8000
} as const

/**
 * A file as the editor gets it. `version` changes whenever the file on disk does: a hash of a text
 * file's bytes, so the app's own save of the same text keeps it. `library` marks a language's own
 * source outside the workspace (standard library, stubs), opened by Go to Definition: read-only.
 */
export type EditorFile =
  | { kind: 'text'; text: string; version: string; library?: true }
  /** Over the editable limit: its start, read-only. */
  | { kind: 'large'; text: string; size: number; version: string; library?: true }
  | { kind: 'binary'; size: number; version: string }
  | { kind: 'missing' }

export type EditorWriteResult =
  | { status: 'saved'; version: string }
  /** The file no longer has the version the text was based on; nothing was written. */
  | { status: 'changed' }

export const EDITOR_CHANNELS = {
  read: 'editor:read-file',
  write: 'editor:write-file',
  release: 'editor:release-file',
  changed: 'editor:files-changed',
  save: 'editor:save',
  setUnsaved: 'editor:set-unsaved',
  closeRequested: 'editor:close-requested',
  answerClose: 'editor:answer-close'
} as const

export type EditorApi = {
  /**
   * Reads a file inside the workspace's folders or worktrees, or one this page holds from where it
   * read it. `missing` only for a path it holds or one whose folder is in the workspace.
   */
  readTextFile: (path: string) => Promise<EditorFile>
  /**
   * Replaces a text file atomically, keeping its permissions: one inside the workspace, or one this
   * page read and hasn't released, as long as the path still leads to the same file.
   */
  writeTextFile: (
    path: string,
    contents: string,
    /** The version the text was based on, or null to overwrite whatever is there. */
    base: string | null
  ) => Promise<EditorWriteResult>
  /** The editor no longer holds the file: outside the workspace, it can't be written any more. */
  releaseTextFile: (path: string) => Promise<void>
  /** Files this page holds changed, appeared or went away on disk (including its own saves). */
  subscribeFileChanges: (callback: (paths: string[]) => void) => () => void
  /** File > Save was chosen; save the active editor tab. */
  subscribeSaveCommand: (callback: () => void) => () => void
  /** Whether any editor tab has unsaved changes; while it does, closing the window or quitting asks first. */
  setUnsavedChanges: (unsaved: boolean) => Promise<void>
  /** The window is closing or the app quitting with unsaved changes; answer with `answerCloseRequest`. */
  subscribeCloseRequest: (callback: () => void) => () => void
  /** Go on closing (the changes were saved or discarded), or cancel it. */
  answerCloseRequest: (proceed: boolean) => Promise<void>
}
