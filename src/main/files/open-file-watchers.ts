import { type FSWatcher, watch } from 'node:fs'
import { basename, dirname } from 'node:path'

/**
 * A file is reported once its events have stopped for this long: a plain write truncates it before
 * filling it, and reading it in between would show the tab an empty file.
 */
const QUIET_MS = 150
/** A file written to without pause is still reported this often. */
const MAX_DELAY_MS = 1000

/** A watched folder and, by file name, the paths the page knows its open files in it by. */
type Folder = { watcher: FSWatcher; files: Map<string, Set<string>> }

/**
 * Watches a page's open files for changes on disk. Their folders are watched, not the files, so a
 * file replaced by a rename (an atomic save), deleted or created again is seen as well as edited.
 */
export class OpenFileWatchers {
  private readonly folders = new Map<string, Folder>()
  private readonly pending = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private firstPending = 0

  constructor(private readonly send: (paths: string[]) => void) {}

  /** Watches exactly `files`: each path the page knows a file by, with the real file it is. */
  set(files: ReadonlyMap<string, string>): void {
    const wanted = new Map<string, Map<string, Set<string>>>()
    for (const [path, real] of files) {
      const folder = dirname(real)
      const names = wanted.get(folder) ?? new Map<string, Set<string>>()
      const paths = names.get(basename(real)) ?? new Set<string>()
      paths.add(path)
      names.set(basename(real), paths)
      wanted.set(folder, names)
    }
    for (const [folder, held] of this.folders) {
      const names = wanted.get(folder)
      if (names) held.files = names
      else this.drop(folder, held)
    }
    for (const [folder, names] of wanted) {
      if (!this.folders.has(folder)) this.open(folder, names)
    }
  }

  private open(folder: string, files: Map<string, Set<string>>): void {
    try {
      const watcher = watch(folder, (_event, name) => {
        const held = this.folders.get(folder)
        if (!held) return
        // Some platforms leave out the name: any of the folder's files may have changed.
        const paths = name === null ? [...held.files.values()] : [held.files.get(name)]
        for (const set of paths) for (const path of set ?? []) this.queue(path)
      })
      // The folder itself went away: its files did too.
      watcher.on('error', () => {
        const held = this.folders.get(folder)
        if (held?.watcher !== watcher) return
        this.drop(folder, held)
        for (const set of held.files.values()) for (const path of set) this.queue(path)
      })
      this.folders.set(folder, { watcher, files })
    } catch {
      // Gone already; the file's tab shows it missing when it is next read.
    }
  }

  private drop(folder: string, held: Folder): void {
    held.watcher.close()
    this.folders.delete(folder)
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
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const [folder, held] of this.folders) this.drop(folder, held)
  }
}
