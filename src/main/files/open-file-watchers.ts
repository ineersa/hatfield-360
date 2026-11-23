import { type FSWatcher, watch } from 'chokidar'
import { isPathInside, realRoots } from './path-containment'
import { type ProjectChange, type ProjectSubscription, watchProject } from './project-watch'

/**
 * A file is reported once its events have stopped for this long: a plain write truncates it before
 * filling it, and reading it in between would show the tab an empty file.
 */
const QUIET_MS = 150
/** A file written to without pause is still reported this often. */
const MAX_DELAY_MS = 1000

/**
 * Watches a page's open files for changes on disk: edited, replaced by a rename (an atomic save),
 * deleted, or moved away with a folder above them and made again. Files in a workspace folder are
 * heard from its project watcher; the rest (ones git ignores, ones outside the workspace) are
 * watched one by one.
 */
export class OpenFileWatchers {
  /** Each open real file, with the paths the page knows it by. */
  private files = new Map<string, Set<string>>()
  private readonly projects = new Map<string, ProjectSubscription>()
  private loose: FSWatcher | null = null
  private looseFiles = new Set<string>()
  private readonly pending = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private firstPending = 0
  /** Bumped per update, so a slow older update can't watch files a newer one dropped. */
  private generation = 0

  constructor(
    private readonly send: (paths: string[]) => void,
    private readonly roots: () => Promise<string[]>
  ) {}

  /** Watches exactly `files`: each path the page knows a file by, with the real file it is. */
  async set(files: ReadonlyMap<string, string>): Promise<void> {
    const generation = ++this.generation
    const byReal = new Map<string, Set<string>>()
    for (const [path, real] of files) byReal.set(real, (byReal.get(real) ?? new Set()).add(path))
    this.files = byReal
    const roots = await realRoots(await this.roots())
    if (generation !== this.generation) return
    const needed = roots.filter((root) =>
      [...byReal.keys()].some((real) => isPathInside(real, root))
    )
    for (const [root, project] of this.projects) {
      if (needed.includes(root)) continue
      project.stop()
      this.projects.delete(root)
    }
    for (const root of needed) {
      if (!this.projects.has(root)) {
        this.projects.set(
          root,
          watchProject(root, (changes) => this.projectChanged(changes))
        )
      }
    }
    await Promise.all([...this.projects.values()].map((project) => project.ready))
    if (generation !== this.generation) return
    const projects = [...this.projects.values()]
    await this.watchLoose(
      new Set([...byReal.keys()].filter((real) => !projects.some((each) => each.covers(real))))
    )
  }

  private projectChanged(changes: ProjectChange[]): void {
    for (const change of changes) this.changed(change.path)
  }

  private changed(real: string): void {
    for (const path of this.files.get(real) ?? []) this.queue(path)
  }

  /** Watches the files no project watcher hears of, anew whenever they change (there are few). */
  private async watchLoose(files: Set<string>): Promise<void> {
    if (
      files.size === this.looseFiles.size &&
      [...files].every((file) => this.looseFiles.has(file))
    )
      return
    void this.loose?.close()
    this.loose = null
    this.looseFiles = files
    if (files.size === 0) return
    const loose = watch([...files], { ignoreInitial: true, atomic: true })
    this.loose = loose
    loose.on('all', (_event, path) => this.changed(path))
    await new Promise<void>((resolve) => loose.once('ready', () => resolve()))
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
    this.generation += 1
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const project of this.projects.values()) project.stop()
    this.projects.clear()
    void this.loose?.close()
    this.loose = null
    this.looseFiles = new Set()
  }
}
