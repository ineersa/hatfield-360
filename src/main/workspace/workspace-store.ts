import { app } from 'electron'
import { readdir, rename, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type {
  RecentEntry,
  RecentTarget,
  WorkspaceFolder,
  WorkspaceView
} from '../../shared/workspace-api'
import {
  type AppState,
  readAppState,
  type RecentItem,
  withRecent,
  writeAppState
} from './app-state'
import {
  readWorkspaceFile,
  WORKSPACE_FILE_EXTENSION,
  withWorkspaceExtension,
  writeWorkspaceFile
} from './workspace-file'

type ChangeListener = (view: WorkspaceView) => void

type OpenWorkspace = {
  file: string
  isDefault: boolean
  /** Absolute paths, in the user's order. */
  folders: string[]
  problem: string | null
}

type Session = { workspace: OpenWorkspace; state: AppState }

const DEFAULT_WORKSPACE_NAME = 'Default Workspace'

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function workspaceFileName(file: string): string {
  return basename(file, WORKSPACE_FILE_EXTENSION)
}

const folderName = (path: string): string => basename(path) || path

/** The default workspace is app-owned: an unreadable file is moved aside and the workspace starts empty. */
async function loadDefaultWorkspace(file: string): Promise<OpenWorkspace> {
  const read = await readWorkspaceFile(file)
  const workspace: OpenWorkspace = { file, isDefault: true, folders: [], problem: null }
  if (read.status === 'ok') return { ...workspace, folders: read.folders }
  if (read.status === 'newer') {
    // Leave the file untouched so the newer app version can still read it.
    return {
      ...workspace,
      problem: `This workspace was saved by a newer version of Hatfield 360 (format ${read.version}). Update the app to change it.`
    }
  }
  if (read.status === 'corrupt') {
    // Keep the unreadable file for the user to inspect.
    await rename(file, `${file}.corrupt-${Date.now()}`)
    console.warn(`Workspace file ${file} was unreadable (${read.reason}); moved it aside.`)
  }
  return workspace
}

/** Workspace files belong to the user: anything unusable is refused with a reason and never touched. */
async function loadWorkspaceFile(file: string): Promise<OpenWorkspace> {
  const read = await readWorkspaceFile(file)
  if (read.status === 'ok') {
    return { file, isDefault: false, folders: read.folders, problem: null }
  }
  const reason =
    read.status === 'missing'
      ? 'the file does not exist'
      : read.status === 'newer'
        ? `it was saved by a newer version of Hatfield 360 (format ${read.version})`
        : `the file is broken (${read.reason})`
  throw new Error(`Can't open workspace "${workspaceFileName(file)}": ${reason}.`)
}

/** The workspace open in the window, the Recent list, and change notifications. */
class WorkspaceStore {
  private session: Promise<Session> | null = null
  private notice: string | null = null
  /** Serializes changes so concurrent actions can't interleave their writes. */
  private queue: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<ChangeListener>()

  constructor(private readonly dataDir: () => string) {}

  onChange(listener: ChangeListener): void {
    this.listeners.add(listener)
  }

  async view(): Promise<WorkspaceView> {
    const { workspace, state } = await this.ready()
    const folders: WorkspaceFolder[] = await Promise.all(
      workspace.folders.map(async (path) => ({
        path,
        name: folderName(path),
        missing: !(await isDirectory(path))
      }))
    )
    const recentWorkspaces = state.recent.filter((item) => item.kind === 'workspace')
    const unlisted = (await this.storedWorkspaceFiles())
      .filter((path) => !recentWorkspaces.some((item) => item.path === path))
      .map((path): RecentItem => ({ kind: 'workspace', path }))
    const ordered = [
      ...recentWorkspaces,
      ...unlisted,
      ...state.recent.filter((item) => item.kind === 'folder')
    ]
    const recent: RecentEntry[] = [
      {
        kind: 'default',
        path: this.defaultFile(),
        name: DEFAULT_WORKSPACE_NAME,
        missing: false,
        current: workspace.isDefault,
        stored: true
      },
      ...(await Promise.all(
        ordered.map(async (item) =>
          item.kind === 'workspace'
            ? {
                ...item,
                name: workspaceFileName(item.path),
                missing: !(await isFile(item.path)),
                current: !workspace.isDefault && item.path === workspace.file,
                stored: this.isStored(item.path)
              }
            : {
                ...item,
                name: folderName(item.path),
                missing: !(await isDirectory(item.path)),
                current: false,
                stored: false
              }
        )
      ))
    ]
    return {
      name: workspace.isDefault ? DEFAULT_WORKSPACE_NAME : workspaceFileName(workspace.file),
      file: workspace.isDefault ? null : workspace.file,
      folders,
      problem: workspace.problem,
      notice: this.notice,
      recent
    }
  }

  /** Adds a folder to the open workspace and to Recent; returns false when it was already in the workspace. */
  addFolder(path: string): Promise<boolean> {
    return this.change((session) => this.addFolderTo(session, resolve(path)))
  }

  removeFolder(path: string): Promise<boolean> {
    return this.change(async ({ workspace }) => {
      if (workspace.problem) throw new Error(workspace.problem)
      const folders = workspace.folders.filter((folder) => folder !== path)
      if (folders.length === workspace.folders.length) return false
      await writeWorkspaceFile(workspace.file, folders)
      workspace.folders = folders
      return true
    })
  }

  openWorkspaceFile(file: string): Promise<void> {
    return this.change(async (session) => {
      const workspace = await loadWorkspaceFile(resolve(file))
      await this.switchTo(session, workspace, remembered(session.state, workspace.file))
    })
  }

  /** Writes the open workspace's folders to a new file and switches to it; the old file is unchanged. */
  saveWorkspaceAs(file: string): Promise<void> {
    return this.change(async (session) => {
      const { workspace } = session
      if (workspace.problem) throw new Error(workspace.problem)
      const target = withWorkspaceExtension(file)
      if (target === this.defaultFile()) throw new Error('Choose another place for the workspace.')
      await writeWorkspaceFile(target, workspace.folders)
      await this.switchTo(
        session,
        { file: target, isDefault: false, folders: workspace.folders, problem: null },
        remembered(session.state, target)
      )
    })
  }

  /** Returns to the default workspace. */
  closeWorkspace(): Promise<void> {
    return this.change((session) => this.openDefault(session))
  }

  /** Opens a Recent entry; returns 'missing' when its file or folder is gone. */
  openRecent(target: RecentTarget): Promise<'opened' | 'missing'> {
    return this.change(async (session) => {
      if (target.kind === 'default') {
        await this.openDefault(session)
        return 'opened'
      }
      const listed =
        session.state.recent.some((item) => isSameItem(item, target)) ||
        (target.kind === 'workspace' && this.isStored(target.path))
      if (!listed) {
        throw new Error(`Not in Recent: ${target.path}`)
      }
      if (target.kind === 'folder') {
        if (!(await isDirectory(target.path))) return 'missing'
        await this.addFolderTo(session, target.path)
        return 'opened'
      }
      if (!(await isFile(target.path))) return 'missing'
      const workspace = await loadWorkspaceFile(target.path)
      await this.switchTo(session, workspace, remembered(session.state, target.path))
      return 'opened'
    })
  }

  removeRecent(target: RecentTarget): Promise<void> {
    return this.change(async (session) => {
      const recent = session.state.recent.filter((item) => !isSameItem(item, target))
      await this.saveState(session, { ...session.state, recent })
    })
  }

  clearRecent(): Promise<void> {
    return this.change(async (session) => {
      await this.saveState(session, { ...session.state, recent: [] })
    })
  }

  /** Shows a failure of an action started outside the window (e.g. the File menu). */
  report(error: unknown): Promise<void> {
    return this.change(() => {
      this.notice = message(error)
      return Promise.resolve()
    })
  }

  /** Hatfield's own workspaces folder: the default workspace and where Save As suggests saving. */
  workspacesFolder(): string {
    return join(this.dataDir(), 'workspaces')
  }

  private defaultFile(): string {
    return join(this.workspacesFolder(), `default${WORKSPACE_FILE_EXTENSION}`)
  }

  private isStored(path: string): boolean {
    return (
      dirname(path) === this.workspacesFolder() &&
      path.endsWith(WORKSPACE_FILE_EXTENSION) &&
      path !== this.defaultFile()
    )
  }

  /** Workspace files saved in Hatfield's workspaces folder, by name. */
  private async storedWorkspaceFiles(): Promise<string[]> {
    let names: string[]
    try {
      names = await readdir(this.workspacesFolder())
    } catch {
      return []
    }
    return names
      .map((name) => join(this.workspacesFolder(), name))
      .filter((path) => this.isStored(path))
      .toSorted((a, b) => a.localeCompare(b))
  }

  private stateFile(): string {
    return join(this.dataDir(), 'state.json')
  }

  private async openDefault(session: Session): Promise<void> {
    const workspace = await loadDefaultWorkspace(this.defaultFile())
    await this.switchTo(session, workspace, { ...session.state, current: null })
  }

  // The session changes only after the write succeeds, so main never runs ahead of what the window shows.
  private async saveState(session: Session, state: AppState): Promise<void> {
    await writeAppState(this.stateFile(), state)
    session.state = state
  }

  private async switchTo(
    session: Session,
    workspace: OpenWorkspace,
    state: AppState
  ): Promise<void> {
    await this.saveState(session, state)
    session.workspace = workspace
  }

  private async addFolderTo(session: Session, folder: string): Promise<boolean> {
    const { workspace } = session
    if (workspace.problem) throw new Error(workspace.problem)
    if (!(await isDirectory(folder))) throw new Error(`Not a folder: ${folder}`)
    const added = !workspace.folders.includes(folder)
    if (added) {
      const folders = [...workspace.folders, folder]
      await writeWorkspaceFile(workspace.file, folders)
      workspace.folders = folders
    }
    const recent = withRecent(session.state.recent, { kind: 'folder', path: folder })
    await this.saveState(session, { ...session.state, recent })
    return added
  }

  private ready(): Promise<Session> {
    this.session ??= this.start()
    return this.session
  }

  /** Reopens the workspace that was open last; falls back to the default workspace when it can't. */
  private async start(): Promise<Session> {
    const state = await readAppState(this.stateFile())
    if (state.current) {
      try {
        return { workspace: await loadWorkspaceFile(state.current), state }
      } catch (error) {
        this.notice = `${message(error)} Opened the default workspace instead.`
      }
    }
    return {
      workspace: await loadDefaultWorkspace(this.defaultFile()),
      state: { ...state, current: null }
    }
  }

  private change<T>(apply: (session: Session) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const session = await this.ready()
      const notice = this.notice
      this.notice = null
      let result: T
      try {
        result = await apply(session)
      } catch (error) {
        this.notice = notice
        throw error
      }
      const view = await this.view()
      for (const listener of this.listeners) listener(view)
      return result
    })
    this.queue = run.catch(() => undefined)
    return run
  }
}

/** App state with the workspace file open and most recent. */
function remembered(state: AppState, file: string): AppState {
  return { current: file, recent: withRecent(state.recent, { kind: 'workspace', path: file }) }
}

function isSameItem(item: RecentItem, target: RecentTarget): boolean {
  return item.kind === target.kind && item.path === target.path
}

export const workspaceStore = new WorkspaceStore(() => app.getPath('userData'))
