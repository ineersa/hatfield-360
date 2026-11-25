import type { BrowserWindow, WebContents } from 'electron'
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { EDITOR_CHANNELS, type EditorFile, type EditorWriteResult } from '../../shared/editor-api'
import { readEditorFile, textVersion } from '../files/editor-file-read'
import { fileRoots } from '../files/file-roots'
import { locateEditorFile, writeFileInRoots, writeFileReadAs } from '../files/guarded-file'
import { OpenFileWatchers } from '../files/open-file-watchers'
import { resolveInsideRoots, resolveOutsideHome } from '../files/path-containment'
import { keybindingsStore } from '../keybindings/keybindings-store'
import { allLibraryRoots } from '../language-servers/language-server-registry'
import { workspaceStore } from '../workspace/workspace-store'
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
const pages = new Set<Held>()

function heldBy(contents: WebContents): Held {
  let page = held.get(contents)
  if (!page) {
    const watchers = new OpenFileWatchers((paths) => {
      if (!contents.isDestroyed()) contents.send(EDITOR_CHANNELS.changed, paths)
    }, rootPaths)
    page = { files: new Map(), watchers }
    held.set(contents, page)
    pages.add(page)
    contents.once('destroyed', () => {
      watchers.close()
      held.delete(contents)
      if (page) pages.delete(page)
    })
  }
  return page
}

function hold(page: Held, path: string, real: string): void {
  if (page.files.get(path) === real) return
  page.files.set(path, real)
  void page.watchers.set(page.files)
}

/**
 * A file outside the workspace, read-only, so not held for saving or watched: anywhere outside the
 * user's home folder, or in a language's library folders (a Go module cache, a pyenv install).
 */
async function readOutside(path: string, refused: unknown): Promise<EditorFile> {
  const real =
    (await resolveInsideRoots(path, await allLibraryRoots())) ??
    (await resolveOutsideHome(path, homedir()))
  if (real === null) throw refused
  const file = await readEditorFile(real)
  return file.kind === 'text' || file.kind === 'large' ? { ...file, outside: true } : file
}

/** Files outside the workspace the app's editor saves: keybindings.json and the workspace's chat map. */
async function isAppFile(path: string): Promise<boolean> {
  return path === keybindingsStore.file() || path === (await workspaceStore.instructionsFile())
}

/** An app file is opened only as itself, never through a link to some other file. */
async function appFile(path: string): Promise<string | null> {
  const real = await realpath(path).catch(() => null)
  if (real === null) return null
  if (real !== join(await realpath(dirname(path)), basename(path))) {
    throw new Error(`${path} links to another file, which the editor doesn't open`)
  }
  return real
}

async function read(contents: WebContents, path: string): Promise<EditorFile> {
  const page = heldBy(contents)
  const real = (await isAppFile(path))
    ? await appFile(path)
    : await locateEditorFile(path, await rootPaths(), page.files.get(path)).catch(
        (error: unknown) => readOutside(path, error)
      )
  if (real === null) return { kind: 'missing' }
  if (typeof real !== 'string') return real
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
  // Which workspace folder's watcher hears of a file depends on the folders.
  fileRoots.onChange(() => {
    for (const page of pages) void page.watchers.rewatch()
  })
  handleTrusted(EDITOR_CHANNELS.read, (event, path) => read(event.sender, checkedPath(path)))

  handleTrusted(EDITOR_CHANNELS.release, (event, path) => {
    const page = held.get(event.sender)
    if (page?.files.delete(checkedPath(path))) void page.watchers.set(page.files)
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
