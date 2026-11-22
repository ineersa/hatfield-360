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
/** Renames and deletes on the way to the folders come in bursts; they are checked once after one. */
const RECHECK_MS = 50

/**
 * A folder with open files and, by file name, the paths the page knows them by. Watched while it
 * exists; `inode` tells it from another folder moved to its path.
 */
type Folder = {
  files: Map<string, Set<string>>
  watcher: FSWatcher | null
  inode: number | null
}

/** A folder above open files' folders, watched for the names on the way down to them. */
type Ancestor = { watcher: FSWatcher; names: Set<string> }

/**
 * Watches a page's open files for changes on disk. Their folders are watched, not the files, so a
 * file replaced by a rename (an atomic save), deleted or created again is seen as well as edited.
 * The folders above them are watched too: renaming or deleting any of them moves the files away
 * without an event in their own folder.
 */
export class OpenFileWatchers {
  private readonly folders = new Map<string, Folder>()
  private readonly ancestors = new Map<string, Ancestor>()
  private readonly pending = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private firstPending = 0
  private recheckTimer: NodeJS.Timeout | null = null

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
      if (names) {
        held.files = names
      } else {
        held.watcher?.close()
        this.folders.delete(folder)
      }
    }
    for (const [folder, names] of wanted) {
      if (this.folders.has(folder)) continue
      this.folders.set(folder, { files: names, watcher: null, inode: null })
      this.open(folder)
    }
    this.watchAncestors()
  }

  private open(folder: string): void {
    const held = this.folders.get(folder)
    if (!held || held.watcher) return
    try {
      const watcher = watch(folder, (_event, name) => {
        if (held.watcher !== watcher) return
        // Some platforms leave out the name: any of the folder's files may have changed.
        const paths = name === null ? [...held.files.values()] : [held.files.get(name)]
        for (const set of paths) for (const path of set ?? []) this.queue(path)
      })
      watcher.on('error', () => {
        if (held.watcher === watcher) this.recheckSoon()
      })
      held.watcher = watcher
      held.inode = null
      void stat(folder).then(
        (stats) => {
          if (held.watcher === watcher) held.inode = stats.ino
        },
        () => this.recheckSoon()
      )
    } catch {
      // Gone (the file's tab shows it missing when it is next read): an ancestor sees it made again.
    }
  }

  /** Watches each existing folder above the open files' folders, for the names leading to them. */
  private watchAncestors(): void {
    const wanted = new Map<string, Set<string>>()
    for (const folder of this.folders.keys()) {
      for (let child = folder, parent = dirname(folder); parent !== child;) {
        const names = wanted.get(parent) ?? new Set<string>()
        names.add(basename(child))
        wanted.set(parent, names)
        child = parent
        parent = dirname(parent)
      }
    }
    for (const [dir, ancestor] of this.ancestors) {
      const names = wanted.get(dir)
      if (names) {
        ancestor.names = names
      } else {
        ancestor.watcher.close()
        this.ancestors.delete(dir)
      }
    }
    for (const [dir, names] of wanted) {
      if (this.ancestors.has(dir)) continue
      try {
        const watcher = watch(dir, (_event, name) => {
          const ancestor = this.ancestors.get(dir)
          if (ancestor?.watcher !== watcher) return
          if (name === null || ancestor.names.has(name)) this.recheckSoon()
        })
        watcher.on('error', () => this.recheckSoon())
        this.ancestors.set(dir, { watcher, names })
      } catch {
        // Gone too: a folder above it sees it made again.
      }
    }
  }

  private recheckSoon(): void {
    if (this.recheckTimer) return
    this.recheckTimer = setTimeout(() => {
      this.recheckTimer = null
      void this.recheck()
    }, RECHECK_MS)
  }

  /**
   * Something on the way to the folders was renamed, deleted or made. The folders above are watched
   * again at their paths, and each folder no longer the one watched (or made again) is watched
   * again, its files reported so their tabs read them again.
   */
  private async recheck(): Promise<void> {
    for (const ancestor of this.ancestors.values()) ancestor.watcher.close()
    this.ancestors.clear()
    this.watchAncestors()
    for (const [folder, held] of this.folders) {
      const inode = await stat(folder).then(
        (stats) => (stats.isDirectory() ? stats.ino : null),
        () => null
      )
      if (this.folders.get(folder) !== held) continue
      if (held.watcher ? inode !== null && inode === held.inode : inode === null) continue
      held.watcher?.close()
      held.watcher = null
      for (const set of held.files.values()) for (const path of set) this.queue(path)
      if (inode !== null) this.open(folder)
    }
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
    if (this.recheckTimer) clearTimeout(this.recheckTimer)
    this.timer = null
    this.recheckTimer = null
    for (const held of this.folders.values()) held.watcher?.close()
    this.folders.clear()
    for (const ancestor of this.ancestors.values()) ancestor.watcher.close()
    this.ancestors.clear()
  }
}
