import { app } from 'electron'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { WorkspaceView } from '../../shared/workspace-api'
import {
  EMPTY_WORKSPACE_DOCUMENT,
  parseWorkspaceDocument,
  serializeWorkspaceDocument,
  type WorkspaceDocument
} from './workspace-document'

type ChangeListener = (view: WorkspaceView) => void

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Writes to a temp file and renames it over the target, so a crash never leaves a half-written file. */
async function writeFileAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, contents, 'utf8')
  await rename(temp, path)
}

/** The open workspace: its file on disk, in-memory document and change notifications. */
class WorkspaceStore {
  private document: WorkspaceDocument = EMPTY_WORKSPACE_DOCUMENT
  private problem: string | null = null
  private loaded: Promise<void> | null = null
  /** Serializes changes so concurrent adds/removes can't interleave their writes. */
  private queue: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<ChangeListener>()

  constructor(private readonly filePath: () => string) {}

  onChange(listener: ChangeListener): void {
    this.listeners.add(listener)
  }

  async view(): Promise<WorkspaceView> {
    await this.load()
    const folders = await Promise.all(
      this.document.folders.map(async ({ path }) => ({
        path,
        name: basename(path) || path,
        missing: !(await isDirectory(path))
      }))
    )
    return { folders, problem: this.problem }
  }

  /** Adds a folder; returns false when it was already in the workspace. */
  addFolder(path: string): Promise<boolean> {
    return this.change(async () => {
      const folder = resolve(path)
      if (!(await isDirectory(folder))) throw new Error(`Not a folder: ${folder}`)
      if (this.document.folders.some((entry) => entry.path === folder)) return false
      this.document = { ...this.document, folders: [...this.document.folders, { path: folder }] }
      return true
    })
  }

  removeFolder(path: string): Promise<boolean> {
    return this.change(async () => {
      const folders = this.document.folders.filter((entry) => entry.path !== path)
      if (folders.length === this.document.folders.length) return false
      this.document = { ...this.document, folders }
      return true
    })
  }

  private change(apply: () => Promise<boolean>): Promise<boolean> {
    const run = this.queue.then(async () => {
      await this.load()
      if (this.problem) throw new Error(this.problem)
      const changed = await apply()
      if (changed) {
        await writeFileAtomic(this.filePath(), serializeWorkspaceDocument(this.document))
        const view = await this.view()
        for (const listener of this.listeners) listener(view)
      }
      return changed
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private load(): Promise<void> {
    this.loaded ??= this.readFromDisk()
    return this.loaded
  }

  private async readFromDisk(): Promise<void> {
    const path = this.filePath()
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
      throw error
    }
    const parsed = parseWorkspaceDocument(text)
    if (parsed.status === 'ok') {
      this.document = parsed.document
    } else if (parsed.status === 'newer') {
      // Leave the file untouched so the newer app version can still read it.
      this.problem = `This workspace was saved by a newer version of Hatfield 360 (format ${parsed.version}). Update the app to change it.`
    } else {
      // Keep the unreadable file for the user to inspect, and start from an empty workspace.
      await rename(path, `${path}.corrupt-${Date.now()}`)
      console.warn(`Workspace file ${path} was unreadable (${parsed.reason}); moved it aside.`)
    }
  }
}

export const workspaceStore = new WorkspaceStore(() =>
  join(app.getPath('userData'), 'workspaces', 'default.hatfield-workspace')
)
