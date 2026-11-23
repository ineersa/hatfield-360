import { type FSWatcher, watch } from 'chokidar'
import { basename, dirname } from 'node:path'
import { ignoredNames, ignoredPaths } from '../git/git-ignore'
import { isPathInside } from './path-containment'

/** Writes come in bursts (a save, a checkout, an install); they are reported together. */
const BATCH_DELAY_MS = 100

export type ProjectChange = {
  path: string
  kind: 'add' | 'change' | 'unlink'
  folder: boolean
}

type Listener = (changes: ProjectChange[]) => void

/**
 * One workspace folder watched with chokidar, all of it but what git ignores and `.git` itself.
 * The ignored set is git's answer, asked again when a `.gitignore` changes; a folder that appears
 * later is checked with git when it arrives.
 */
class ProjectWatch {
  readonly listeners = new Set<Listener>()
  readonly ready: Promise<boolean>
  private ignored = new Set<string>()
  private watcher: FSWatcher | null = null
  private pending: ProjectChange[] = []
  private timer: NodeJS.Timeout | null = null
  private closed = false
  private failed = false

  constructor(
    readonly root: string,
    private readonly fail: (message: string) => void
  ) {
    this.ready = this.start()
  }

  /** Whether changes to `path` are heard here: inside the folder and not ignored. */
  covers(path: string): boolean {
    return isPathInside(path, this.root) && !this.isIgnored(path)
  }

  close(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    void this.watcher?.close()
  }

  private async start(): Promise<boolean> {
    this.ignored = new Set(await ignoredPaths(this.root))
    if (this.closed) return false
    const watcher = watch(this.root, {
      ignoreInitial: true,
      atomic: true,
      ignored: (path: string) => this.isIgnored(path)
    })
    this.watcher = watcher
    watcher.on('add', (path) => this.changed({ path, kind: 'add', folder: false }))
    watcher.on('addDir', (path) => this.changed({ path, kind: 'add', folder: true }))
    watcher.on('change', (path) => this.changed({ path, kind: 'change', folder: false }))
    watcher.on('unlink', (path) => this.changed({ path, kind: 'unlink', folder: false }))
    watcher.on('unlinkDir', (path) => this.changed({ path, kind: 'unlink', folder: true }))
    watcher.on('error', (error) => this.report(error))
    return new Promise((resolve) => {
      watcher.once('ready', () => resolve(true))
      watcher.once('error', () => resolve(false))
    })
  }

  private isIgnored(path: string): boolean {
    for (let each = path; isPathInside(each, this.root); each = dirname(each)) {
      if (basename(each) === '.git' || this.ignored.has(each)) return true
      if (each === this.root) break
    }
    return false
  }

  private changed(change: ProjectChange): void {
    if (basename(change.path) === '.gitignore') void this.refreshIgnored()
    else if (change.kind === 'add' && change.folder) void this.checkIgnored(change.path)
    this.pending.push(change)
    this.timer ??= setTimeout(() => {
      this.timer = null
      const changes = this.pending.filter((each) => !this.isIgnored(each.path))
      this.pending = []
      if (changes.length > 0) for (const listener of this.listeners) listener(changes)
    }, BATCH_DELAY_MS)
  }

  /** A new folder git ignores (a fresh `node_modules`) stops being watched. */
  private async checkIgnored(folder: string): Promise<void> {
    const ignored = await ignoredNames(dirname(folder), [basename(folder)])
    if (this.closed || !ignored.has(basename(folder))) return
    this.ignored.add(folder)
    this.watcher?.unwatch(folder)
  }

  private async refreshIgnored(): Promise<void> {
    const now = new Set(await ignoredPaths(this.root))
    if (this.closed) return
    const before = this.ignored
    this.ignored = now
    for (const path of before) if (!now.has(path)) this.watcher?.add(path)
    for (const path of now) if (!before.has(path)) this.watcher?.unwatch(path)
  }

  private report(error: unknown): void {
    if (this.failed || this.closed) return
    this.failed = true
    const reason = error instanceof Error ? error.message : String(error)
    this.fail(`Changes on disk under ${this.root} may be missed: ${reason}`)
  }
}

const projects = new Map<string, ProjectWatch>()

export type ProjectSubscription = {
  /** Resolves once changes are heard, false when the folder couldn't be watched. */
  ready: Promise<boolean>
  covers: (path: string) => boolean
  stop: () => void
}

/**
 * Hears of changes in the workspace folder `root` (a real path). Every listener on the same folder
 * shares one watcher, which closes with its last listener.
 */
export function watchProject(root: string, listener: Listener): ProjectSubscription {
  let project = projects.get(root)
  if (!project) {
    project = new ProjectWatch(root, (message) => console.warn(message))
    projects.set(root, project)
  }
  const watched = project
  watched.listeners.add(listener)
  return {
    ready: watched.ready,
    covers: (path) => watched.covers(path),
    stop: () => {
      watched.listeners.delete(listener)
      if (watched.listeners.size > 0 || projects.get(root) !== watched) return
      watched.close()
      projects.delete(root)
    }
  }
}
