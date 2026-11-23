import { type FSWatcher, watch } from 'chokidar'
import { basename, dirname } from 'node:path'
import { isPathInside, resolveInsideRoots } from './path-containment'

/** Editors and git write several entries at once; report the folder once they're done. */
const BATCH_DELAY_MS = 100

type Send = (paths: string[]) => void

/** Watches the folders a window has expanded, their own entries only, reported per folder in batches. */
export class DirectoryWatchers {
  private wanted: string[] = []
  private readonly watchers = new Map<string, { watcher: FSWatcher; real: string }>()
  private readonly pending = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  /** Bumped per update, so a slow older update can't open watches a newer one dropped. */
  private generation = 0

  constructor(private readonly send: Send) {}

  /** Watches exactly `paths`, those inside `roots`; called again when either changes. */
  async set(paths: string[], roots: string[]): Promise<void> {
    const generation = ++this.generation
    this.wanted = paths
    const resolved = await Promise.all(paths.map((path) => resolveInsideRoots(path, roots)))
    if (generation !== this.generation) return
    const allowed = new Map<string, string>()
    paths.forEach((path, index) => {
      const real = resolved[index]
      if (real) allowed.set(path, real)
    })
    for (const [path, held] of this.watchers) {
      if (allowed.get(path) === held.real) continue
      void held.watcher.close()
      this.watchers.delete(path)
    }
    const opened = [...allowed]
      .filter(([path]) => !this.watchers.has(path))
      .map(([path, real]) => this.open(path, real))
    await Promise.all(opened)
  }

  /** Watches the folder's real location, reported under the path the window knows it by. */
  private open(path: string, real: string): Promise<void> {
    const watcher = watch(real, { ignoreInitial: true, depth: 0 })
    this.watchers.set(path, { watcher, real })
    watcher.on('all', (event, changed) => {
      if (changed !== real && dirname(changed) !== real) return
      // A changed `.gitignore` can change the ignore status of every expanded folder under it.
      if (basename(changed) === '.gitignore') {
        for (const other of this.wanted) if (isPathInside(other, path)) this.queue(other)
        return
      }
      // Content changes don't change the listing.
      if (event !== 'change') this.queue(path)
    })
    // Gone or unreadable: its listing already says so. Dropped, so a later update watches it again.
    watcher.on('error', () => {
      void watcher.close()
      if (this.watchers.get(path)?.watcher === watcher) this.watchers.delete(path)
    })
    return new Promise((resolve) => {
      watcher.once('ready', () => resolve())
      watcher.once('error', () => resolve())
    })
  }

  private queue(path: string): void {
    this.pending.add(path)
    this.timer ??= setTimeout(() => {
      this.timer = null
      const paths = [...this.pending]
      this.pending.clear()
      this.send(paths)
    }, BATCH_DELAY_MS)
  }

  close(): void {
    this.generation += 1
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const { watcher } of this.watchers.values()) void watcher.close()
    this.watchers.clear()
  }
}
