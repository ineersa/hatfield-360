import { type FSWatcher, watch } from 'chokidar'
import { dirname } from 'node:path'
import { isPathInside, realRoots } from './path-containment'
import { type ProjectChange, observeProjects, projectCovering } from './project-watch'

/**
 * A file is reported once its events have stopped for this long: a plain write truncates it before
 * filling it, and reading it in between would show the tab an empty file.
 */
const QUIET_MS = 150
/** A file written to without pause is still reported this often. */
const MAX_DELAY_MS = 1000

/**
 * Watches a page's open files for changes on disk: edited, replaced by a rename (an atomic save),
 * deleted, or moved away with a folder above them and made again. A file a project watcher already
 * hears of (a language server's) is heard from it; opening a file never watches a whole folder.
 * The rest are watched one by one, with the folders between them and their workspace folder (one
 * level deep each, to hear one of them renamed away or made again), and move between the two as
 * project watchers start, stop or change what git ignores.
 */
export class OpenFileWatchers {
  /** The paths the page holds, with the real file each is. */
  private held: ReadonlyMap<string, string> = new Map()
  private heldKey = ''
  /** The latest update of what is watched, resolving once it watches. */
  private update: Promise<void> = Promise.resolve()
  /** Each open real file, with the paths the page knows it by. */
  private files = new Map<string, Set<string>>()
  /** The project watchers followed, by root, with what stops following each. */
  private readonly followed = new Map<string, () => void>()
  private loose: FSWatcher | null = null
  /** What the loose watcher watches, as a key, so an unchanged set isn't watched anew. */
  private looseKey = ''
  /** Resolves once the loose watcher hears changes. */
  private looseReady: Promise<void> = Promise.resolve()
  private readonly pending = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private firstPending = 0
  /** Bumped per update, so a slow older update can't watch files a newer one dropped. */
  private generation = 0
  private closed = false
  private readonly unobserve: () => void

  constructor(
    private readonly send: (paths: string[]) => void,
    private readonly roots: () => Promise<string[]>
  ) {
    this.unobserve = observeProjects(() => void this.rewatch())
  }

  /**
   * Watches exactly `files`: each path the page knows a file by, with the real file it is. Resolves
   * once they are watched; the same files again wait for the update under way.
   */
  set(files: ReadonlyMap<string, string>): Promise<void> {
    const key = [...files].map((entry) => entry.join('\0')).join('\0\0')
    if (key === this.heldKey) return this.update
    this.held = new Map(files)
    this.heldKey = key
    return this.rewatch()
  }

  /** Watches the same files anew: the workspace folders changed, and with them what is watched. */
  rewatch(): Promise<void> {
    this.update = this.watchHeld()
    return this.update
  }

  private async watchHeld(): Promise<void> {
    if (this.closed) return
    const generation = ++this.generation
    const files = this.held
    const byReal = new Map<string, Set<string>>()
    for (const [path, real] of files) byReal.set(real, (byReal.get(real) ?? new Set()).add(path))
    this.files = byReal
    const needed = new Map<string, (listener: (changes: ProjectChange[]) => void) => () => void>()
    const loose = new Set<string>()
    for (const real of byReal.keys()) {
      const project = projectCovering(real)
      if (project) needed.set(project.root, project.follow)
      else loose.add(real)
    }
    for (const [root, unfollow] of this.followed) {
      if (needed.has(root)) continue
      unfollow()
      this.followed.delete(root)
    }
    for (const [root, follow] of needed) {
      if (!this.followed.has(root)) {
        this.followed.set(
          root,
          follow((changes) => this.projectChanged(changes))
        )
      }
    }
    const roots = await realRoots(await this.roots())
    if (generation === this.generation) await this.watchLoose(loose, roots)
  }

  private projectChanged(changes: ProjectChange[]): void {
    for (const change of changes) this.changed(change.path)
  }

  private changed(real: string): void {
    for (const path of this.files.get(real) ?? []) this.queue(path)
  }

  /** Watches the files no project watcher hears of, anew whenever they change (there are few). */
  private async watchLoose(files: Set<string>, roots: string[]): Promise<void> {
    const paths = new Set(files)
    for (const file of files) {
      const root = roots.find((each) => isPathInside(file, each))
      if (root === undefined) continue
      for (let folder = dirname(file); isPathInside(folder, root); folder = dirname(folder)) {
        paths.add(folder)
        if (folder === root) break
      }
    }
    const key = [...paths].toSorted().join('\0')
    if (key === this.looseKey) return this.looseReady
    void this.loose?.close()
    this.loose = null
    this.looseKey = key
    this.looseReady = Promise.resolve()
    if (paths.size === 0) return
    const loose = watch([...paths], { ignoreInitial: true, atomic: true, depth: 0 })
    this.loose = loose
    loose.on('all', (event, path) => {
      if (event === 'unlinkDir') this.folderChanged(path)
      else if (event === 'addDir') void this.folderMade(path)
      else this.changed(path)
    })
    // Unhandled, a watcher's error (out of inotify watches, a folder made unreadable) ends main.
    loose.on('error', (error) =>
      console.warn(`Changes on disk to open files may be missed: ${String(error)}`)
    )
    this.looseReady = new Promise<void>((resolve) => {
      loose.once('ready', () => resolve())
      loose.once('error', () => resolve())
    })
    return this.looseReady
  }

  /** Open files under a folder that went away (renamed, deleted) are reported. */
  private folderChanged(folder: string): void {
    for (const real of this.files.keys()) if (isPathInside(real, folder)) this.changed(real)
  }

  /**
   * A folder made again where open files were: their old watches died with the folder, so they are
   * watched anew, then reported in case they were written before the new watch heard them.
   */
  private async folderMade(folder: string): Promise<void> {
    if (![...this.files.keys()].some((real) => isPathInside(real, folder))) return
    this.looseKey = ''
    await this.rewatch()
    this.folderChanged(folder)
  }

  private queue(path: string): void {
    if (this.pending.size === 0) this.firstPending = Date.now()
    this.pending.add(path)
    if (this.timer) clearTimeout(this.timer)
    const waited = Date.now() - this.firstPending
    this.timer = setTimeout(
      () => {
        this.timer = null
        const paths = [...this.pending]
        this.pending.clear()
        this.send(paths)
      },
      Math.max(0, Math.min(QUIET_MS, MAX_DELAY_MS - waited))
    )
  }

  close(): void {
    this.closed = true
    this.unobserve()
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const unfollow of this.followed.values()) unfollow()
    this.followed.clear()
    void this.loose?.close()
    this.loose = null
    this.looseKey = ''
  }
}
