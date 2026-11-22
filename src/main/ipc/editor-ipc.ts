import type { BrowserWindow, WebContents } from 'electron'
import { EDITOR_CHANNELS } from '../../shared/editor-api'
import { fileRoots } from '../files/file-roots'
import { readFileInRoots, writeFileInRoots, writeFileReadAs } from '../files/guarded-file'
import { resolveInsideRoots } from '../files/path-containment'
import { answerClose, setUnsaved } from '../window/unsaved-changes-guard'
import { handleTrusted } from './trusted-ipc'

const rootPaths = async (): Promise<string[]> =>
  (await fileRoots.current()).map((root) => root.path)

function checkedPath(path: unknown): string {
  if (typeof path !== 'string' || path === '') throw new Error('Expected a file path')
  return path
}

/**
 * For each page, the real file each path its editor holds resolved to when read from the workspace.
 * Its tab outlives a workspace switch or a removed folder while it holds unsaved changes, so it can
 * still be saved to that same file, and only to it, until the page releases it or goes away.
 */
const opened = new WeakMap<WebContents, Map<string, string>>()

function openedBy(contents: WebContents): Map<string, string> {
  let files = opened.get(contents)
  if (!files) {
    files = new Map()
    opened.set(contents, files)
    contents.once('destroyed', () => opened.delete(contents))
  }
  return files
}

export function registerEditorIpc(): void {
  handleTrusted(EDITOR_CHANNELS.read, async (event, value) => {
    const path = checkedPath(value)
    const { text, real } = await readFileInRoots(path, await rootPaths())
    openedBy(event.sender).set(path, real)
    return text
  })

  handleTrusted(EDITOR_CHANNELS.release, (event, path) => {
    opened.get(event.sender)?.delete(checkedPath(path))
  })

  handleTrusted(EDITOR_CHANNELS.write, async (event, path, contents) => {
    if (typeof contents !== 'string') throw new Error('Expected the file contents as text')
    const file = checkedPath(path)
    const roots = await rootPaths()
    const read = opened.get(event.sender)?.get(file)
    if (read !== undefined && (await resolveInsideRoots(file, roots)) === null) {
      await writeFileReadAs(file, contents, read)
    } else {
      await writeFileInRoots(file, contents, roots)
    }
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
