import { type FSWatcher, watch } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

/**
 * A file is reported once its events have stopped for this long: a plain write truncates it before
 * filling it, and reading it in between would show the tab an empty file.
 */
const QUIET_MS = 150
/** A file written to without pause is still reported this often. */
const MAX_DELAY_MS = 1000

/**
 * A watched folder and, by file name, the paths the page knows its open files in it by. `inode` is
 * the folder's, to tell it from another folder moved to its path.
 */
type Folder = { watcher: FSWatcher; files: Map<string, Set<string>>; inode: number | null }

/**
 * Watches a page's open files for changes on disk. Their folders are watched, not the files, so a
 * file replaced by a rename (an atomic save), deleted or created again is seen as well as edited.
 */
export class OpenFileWatchers {
  private readonly folders = new Map<string, Folder>()
  /** Folders of open files that don't exist now, by the watcher of the folder they'd be made in. */
  private readonly absent = new Map<string, Omit<Folder, 'inode'>>()
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
    for (const [held, drop] of [
      [this.folders, (folder: string) => this.drop(folder)],
      [this.absent, (folder: string) => this.stopWaiting(folder)]
    ] as const) {
      for (const [folder, entry] of held) {
        const names = wanted.get(folder)
        if (names) entry.files = names
        else drop(folder)
      }
    }
    for (const [folder, names] of wanted) {
      if (!this.folders.has(folder) && !this.absent.has(folder)) this.open(folder, names)
    }
  }

  private open(folder: string, files: Map<string, Set<string>>): void {
    try {
      const watcher = watch(folder, (event, name) => {
        const held = this.folders.get(folder)
        if (held?.watcher !== watcher) return
        // Some platforms leave out the name: any of the folder's files may have changed.
        const paths = name === null ? [...held.files.values()] : [held.files.get(name)]
        for (const set of paths) for (const path of set ?? []) this.queue(path)
        // Renaming the folder itself reports its own name, or none, on Linux.
        if (event === 'rename' && (name === null || !held.files.has(name))) void this.check(folder)
      })
      // The folder itself went away: its files did too.
      watcher.on('error', () => this.moved(folder, watcher))
      const held: Folder = { watcher, files, inode: null }
      this.folders.set(folder, held)
      void stat(folder)
        .then((stats) => {
          held.inode = stats.ino
        })
        .catch(() => this.moved(folder, watcher))
    } catch {
      // Gone already (the file's tab shows it missing when it is next read): watched for once made.
      this.waitFor(folder, files)
    }
  }

  /** Watches the folder's parent until the folder is made again, then reports its open files. */
  private waitFor(folder: string, files: Map<string, Set<string>>): void {
    try {
      const watcher = watch(dirname(folder), (_event, name) => {
        const waiting = this.absent.get(folder)
        if (waiting?.watcher !== watcher || (name !== null && name !== basename(folder))) return
        this.stopWaiting(folder)
        this.open(folder, waiting.files)
        if (this.folders.has(folder))
          for (const set of waiting.files.values()) for (const path of set) this.queue(path)
      })
      watcher.on('error', () => {
        if (this.absent.get(folder)?.watcher === watcher) this.stopWaiting(folder)
      })
      this.absent.set(folder, { watcher, files })
    } catch {
      // Its parent is gone too: saving the file makes the folders and watches it again.
    }
  }

  private stopWaiting(folder: string): void {
    this.absent.get(folder)?.watcher.close()
    this.absent.delete(folder)
  }

  /** The folder at the path is no longer the one watched: renamed, deleted or replaced. */
  private async check(folder: string): Promise<void> {
    const held = this.folders.get(folder)
    if (!held || held.inode === null) return
    const inode = await stat(folder).then(
      (stats) => stats.ino,
      () => null
    )
    if (inode !== held.inode) this.moved(folder, held.watcher)
  }

  /** Reports the folder's files and watches whatever folder is at its path now, if any. */
  private moved(folder: string, watcher: FSWatcher): void {
    const held = this.folders.get(folder)
    if (held?.watcher !== watcher) return
    this.drop(folder)
    for (const set of held.files.values()) for (const path of set) this.queue(path)
    this.open(folder, held.files)
  }

  private drop(folder: string): void {
    this.folders.get(folder)?.watcher.close()
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
    for (const folder of this.folders.keys()) this.drop(folder)
    for (const folder of this.absent.keys()) this.stopWaiting(folder)
  }
}
