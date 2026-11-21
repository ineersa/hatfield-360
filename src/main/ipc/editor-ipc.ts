import type { BrowserWindow } from 'electron'
import { EDITOR_CHANNELS } from '../../shared/editor-api'
import { fileRoots } from '../files/file-roots'
import { readFileInRoots, writeFileInRoots } from '../files/guarded-file'
import { handleTrusted } from './trusted-ipc'

const rootPaths = async (): Promise<string[]> =>
  (await fileRoots.current()).map((root) => root.path)

function checkedPath(path: unknown): string {
  if (typeof path !== 'string' || path === '') throw new Error('Expected a file path')
  return path
}

export function registerEditorIpc(): void {
  handleTrusted(EDITOR_CHANNELS.read, async (_event, path) =>
    readFileInRoots(checkedPath(path), await rootPaths())
  )

  handleTrusted(EDITOR_CHANNELS.write, async (_event, path, contents) => {
    if (typeof contents !== 'string') throw new Error('Expected the file contents as text')
    await writeFileInRoots(checkedPath(path), contents, await rootPaths())
  })
}

/** Runs File > Save in the window's active editor tab. */
export function sendSaveCommand(window: BrowserWindow | null): Promise<void> {
  if (!window) return Promise.reject(new Error('No window to save in.'))
  window.webContents.send(EDITOR_CHANNELS.save)
  return Promise.resolve()
}
