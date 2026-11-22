import type { BrowserWindow, WebContents } from 'electron'
import { realpath } from 'node:fs/promises'
import { EDITOR_CHANNELS, type EditorFile, type EditorWriteResult } from '../../shared/editor-api'
import { readEditorFile, textVersion } from '../files/editor-file-read'
import { fileRoots } from '../files/file-roots'
import { locateEditorFile, writeFileInRoots, writeFileReadAs } from '../files/guarded-file'
import { OpenFileWatchers } from '../files/open-file-watchers'
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
 * What a page's editor holds: the real file each path resolved to when read from the workspace,
 * and the watch on those files. A tab outlives a workspace switch or a removed folder while it holds
 * unsaved changes, so its file can still be read and saved there, and only there, until the page
 * releases it or goes away.
 */
type Held = { files: Map<string, string>; watchers: OpenFileWatchers }

const held = new WeakMap<WebContents, Held>()

function heldBy(contents: WebContents): Held {
  let page = held.get(contents)
  if (!page) {
    const watchers = new OpenFileWatchers((paths) => {
      if (!contents.isDestroyed()) contents.send(EDITOR_CHANNELS.changed, paths)
    })
    page = { files: new Map(), watchers }
    held.set(contents, page)
    contents.once('destroyed', () => {
      watchers.close()
      held.delete(contents)
    })
  }
  return page
}

function hold(page: Held, path: string, real: string): void {
  if (page.files.get(path) === real) return
  page.files.set(path, real)
  page.watchers.set(page.files)
}

async function read(contents: WebContents, path: string): Promise<EditorFile> {
  const page = heldBy(contents)
  const real = await locateEditorFile(path, await rootPaths(), page.files.get(path))
  if (real === null) return { kind: 'missing' }
  const file = await readEditorFile(real)
  if (file.kind !== 'missing') hold(page, path, real)
  return file
}

async function write(
  contents: WebContents,
  path: string,
  text: string,
  base: string | null
): Promise<EditorWriteResult> {
  const page = heldBy(contents)
  const roots = await rootPaths()
  const known = page.files.get(path)
  const real = await locateEditorFile(path, roots, known)
  // A file deleted on disk is created again; one changed there is not overwritten unasked.
  if (base !== null && real !== null) {
    const current = await readEditorFile(real)
    if (current.kind !== 'missing' && current.version !== base) return { status: 'changed' }
  }
  if (real !== null && real === known && (await resolveInsideRoots(path, roots)) === null) {
    await writeFileReadAs(path, text, real)
  } else {
    await writeFileInRoots(path, text, roots)
  }
  if (known !== undefined) {
    const now = await realpath(path).catch(() => null)
    if (now !== null) hold(page, path, now)
  }
  return { status: 'saved', version: textVersion(text) }
}

export function registerEditorIpc(): void {
  handleTrusted(EDITOR_CHANNELS.read, (event, path) => read(event.sender, checkedPath(path)))

  handleTrusted(EDITOR_CHANNELS.release, (event, path) => {
    const page = held.get(event.sender)
    if (page?.files.delete(checkedPath(path))) page.watchers.set(page.files)
  })

  handleTrusted(EDITOR_CHANNELS.write, (event, path, contents, base) => {
    if (typeof contents !== 'string') throw new Error('Expected the file contents as text')
    if (base !== null && typeof base !== 'string') throw new Error('Expected the version or null')
    return write(event.sender, checkedPath(path), contents, base)
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
