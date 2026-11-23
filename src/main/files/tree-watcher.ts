import { type FSWatcher, watch } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { isPathInside } from './path-containment'

/** Writes come in bursts (a save, a checkout); they are reported together once it settles. */
const BATCH_DELAY_MS = 100

/** LSP's file change types. */
export type TreeChange = { path: string; type: 1 | 2 | 3 }

/** Never watched. */
const SKIPPED = new Set(['.git'])
/** Watched for packages coming and going, but not inside them. */
const SHALLOW = new Set(['node_modules'])

/**
 * Watches every folder under a root, one non-recursive watch each, so files created, changed or
 * deleted anywhere in it are reported. Dependency folders are watched only at their top.
 */
export class TreeWatcher {
  private readonly watchers = new Map<string, FSWatcher>()
  private readonly pending = new Map<string, 'rename' | 'change'>()
  private timer: NodeJS.Timeout | null = null
  private closed = false

  constructor(
    private readonly root: string,
    private readonly send: (changes: TreeChange[]) => void
  ) {}

  /** Starts watching; resolves once every folder there is now is watched. */
  start(): Promise<void> {
    return this.watchTree(this.root)
  }

  close(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
  }

  /** Watches `folder` and the folders under it; files found are added to `files` when given. */
  private async watchTree(folder: string, files?: string[]): Promise<void> {
    if (this.closed || this.watchers.has(folder) || SKIPPED.has(basename(folder))) return
    try {
      const watcher = watch(folder, (event, name) => {
        if (name) this.queue(join(folder, name), event)
      })
      watcher.on('error', () => this.unwatch(folder))
      this.watchers.set(folder, watcher)
    } catch {
      return
    }
    if (SHALLOW.has(basename(folder))) return
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
    if (files) {
      for (const entry of entries) if (entry.isFile()) files.push(join(folder, entry.name))
    }
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.watchTree(join(folder, entry.name), files))
    )
  }

  /** Stops watching a folder that went away, and everything under it. */
  private unwatch(folder: string): void {
    for (const [path, watcher] of this.watchers) {
      if (path === folder || isPathInside(path, folder)) {
        watcher.close()
        this.watchers.delete(path)
      }
    }
  }

  private queue(path: string, event: 'rename' | 'change'): void {
    // A rename (created or deleted) outweighs a change to the same path.
    if (this.pending.get(path) !== 'rename') this.pending.set(path, event)
    this.timer ??= setTimeout(() => void this.flush(), BATCH_DELAY_MS)
  }

  private async flush(): Promise<void> {
    this.timer = null
    const batch = [...this.pending]
    this.pending.clear()
    const changes = await Promise.all(
      batch.map(async ([path, event]): Promise<TreeChange[]> => {
        const info = await lstat(path).catch(() => null)
        if (!info) {
          this.unwatch(path)
          return [{ path, type: 3 }]
        }
        if (!info.isDirectory()) return [{ path, type: event === 'rename' ? 1 : 2 }]
        if (this.watchers.has(path)) return []
        // A folder that arrived with files in it (a checkout, an unpacked archive).
        const files: string[] = []
        await this.watchTree(path, files)
        return [{ path, type: 1 }, ...files.map((file): TreeChange => ({ path: file, type: 1 }))]
      })
    )
    const found = changes.flat()
    if (!this.closed && found.length > 0) this.send(found)
  }
}
