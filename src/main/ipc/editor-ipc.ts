import type { BrowserWindow } from 'electron'
import { EDITOR_CHANNELS } from '../../shared/editor-api'
import { fileRoots } from '../files/file-roots'
import { readFileInRoots, writeFileInRoots } from '../files/guarded-file'
import { answerClose, setUnsaved } from '../window/unsaved-changes-guard'
import { handleTrusted } from './trusted-ipc'

const rootPaths = async (): Promise<string[]> =>
  (await fileRoots.current()).map((root) => root.path)

function checkedPath(path: unknown): string {
  if (typeof path !== 'string' || path === '') throw new Error('Expected a file path')
  return path
}

/**
 * Files the editor read from the workspace. Their tabs outlive a workspace switch or a removed folder
 * while they hold unsaved changes, so they can still be saved where they were read from.
 */
const opened = new Set<string>()

export function registerEditorIpc(): void {
  handleTrusted(EDITOR_CHANNELS.read, async (_event, value) => {
    const path = checkedPath(value)
    const text = await readFileInRoots(path, await rootPaths())
    opened.add(path)
    return text
  })

  handleTrusted(EDITOR_CHANNELS.write, async (_event, path, contents) => {
    if (typeof contents !== 'string') throw new Error('Expected the file contents as text')
    const file = checkedPath(path)
    const roots = await rootPaths()
    await writeFileInRoots(file, contents, opened.has(file) ? [...roots, file] : roots)
  })

  handleTrusted(EDITOR_CHANNELS.setUnsaved, (event, unsaved) => {
    if (typeof unsaved !== 'boolean') throw new Error('Expected whether changes are unsaved')
    setUnsaved(event.sender, unsaved)
  })

  handleTrusted(EDITOR_CHANNELS.answerClose, (event, proceed) => {
    if (typeof proceed !== 'boolean') throw new Error('Expected whether to go on closing')
    answerClose(event.sender, proceed)
  })
}

/** Runs File > Save in the window's active editor tab. */
export function sendSaveCommand(window: BrowserWindow | null): Promise<void> {
  if (!window) return Promise.reject(new Error('No window to save in.'))
  window.webContents.send(EDITOR_CHANNELS.save)
  return Promise.resolve()
}
