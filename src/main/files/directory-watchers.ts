import { type FSWatcher, watch } from 'node:fs'
import { stat } from 'node:fs/promises'
import { isPathInside, resolveInsideRoots } from './path-containment'

/** Editors and git write several entries at once; report the folder once they're done. */
const BATCH_DELAY_MS = 100

type Send = (paths: string[]) => void

/** The folder's inode, so a folder replaced at the same path is watched anew. */
type Watch = { watcher: FSWatcher; ino: number }

/** Non-recursive watches on the folders a window has expanded, reported per folder in batches. */
export class DirectoryWatchers {
  private wanted: string[] = []
  private readonly watchers = new Map<string, Watch>()
  private readonly pending = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  /** Bumped per update, so a slow older update can't open watches a newer one dropped. */
  private generation = 0

  constructor(private readonly send: Send) {}

  /** Watches exactly `paths`, those inside `roots`; called again when either changes. */
  async set(paths: string[], roots: string[]): Promise<void> {
    const generation = ++this.generation
    this.wanted = paths
    const resolved = await Promise.all(
      paths.map(async (path) => {
        const real = await resolveInsideRoots(path, roots)
        if (real === null) return null
        const ino = await stat(real).then(
          (info) => info.ino,
          () => null
        )
        return ino === null ? null : { real, ino }
      })
    )
    if (generation !== this.generation) return
    const allowed = new Map<string, { real: string; ino: number }>()
    paths.forEach((path, index) => {
      const found = resolved[index]
      if (found) allowed.set(path, found)
    })
    for (const [path, held] of this.watchers) {
      if (allowed.get(path)?.ino === held.ino) continue
      held.watcher.close()
      this.watchers.delete(path)
    }
    for (const [path, { real, ino }] of allowed) {
      if (!this.watchers.has(path)) this.open(path, real, ino)
    }
  }

  /** Watches the folder's real location, reported under the path the window knows it by. */
  private open(path: string, real: string, ino: number): void {
    try {
      const watcher = watch(real, (event, name) => {
        // A changed `.gitignore` can change the ignore status of every expanded folder under it.
        if (name === '.gitignore') {
          for (const other of this.wanted) if (isPathInside(other, path)) this.queue(other)
          return
        }
        // Content changes don't change the listing.
        if (event === 'change' && name !== null) return
        this.queue(path)
      })
      // The folder was deleted; a later `set` watches it again if it comes back.
      watcher.on('error', () => {
        watcher.close()
        if (this.watchers.get(path)?.watcher === watcher) this.watchers.delete(path)
        this.queue(path)
      })
      this.watchers.set(path, { watcher, ino })
    } catch {
      // Gone between resolving and watching; its parent's listing shows that.
    }
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
    for (const { watcher } of this.watchers.values()) watcher.close()
    this.watchers.clear()
  }
}
