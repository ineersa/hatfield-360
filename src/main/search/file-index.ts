import { rgPath } from '@vscode/ripgrep'
import { spawn } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { DEPENDENCY_FOLDER_NAMES } from '../../shared/dependency-folders'
import { compareMatches, fuzzyPathMatch } from '../../shared/fuzzy-path-match'
import { FILE_HIT_LIMIT, type FileHit } from '../../shared/search-everywhere-api'
import { unpackedPath } from '../asar-unpacked-path'
import { type ProjectChange, watchProject } from '../files/project-watch'
import { isPathInside } from '../files/path-containment'

/** Paths matched between yields to the event loop, so a large workspace never stalls main. */
const CHUNK = 2000

/** ripgrep's arguments to list a folder's files as Find in Files sees them: git's ignores, no dependency folders. */
function listFilesArgs(): string[] {
  return [
    '--files',
    '--no-config',
    '--hidden',
    '--glob=!.git',
    ...DEPENDENCY_FOLDER_NAMES.map((name) => `--glob=!${name}`)
  ]
}

/** Every file ripgrep lists in `root`, relative to it with `/` separators. */
export function listFiles(root: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(unpackedPath(rgPath), listFilesArgs(), {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    })
    const files: string[] = []
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      if (line !== '') files.push(line.split(sep).join('/'))
    })
    child.on('error', reject)
    // ripgrep exits 1 for a folder with no files, 2 for files it couldn't read; both still list.
    child.on('close', (code) => {
      lines.close()
      if (code === 0 || code === 1 || code === 2) resolve(files)
      else reject(new Error(`ripgrep stopped listing ${root} (exit ${String(code)})`))
    })
  })
}

/** One workspace folder's files, kept current from its project watcher. */
export class FolderFiles {
  readonly files = new Set<string>()

  constructor(readonly root: string) {}

  /** Applies what the watcher heard: a file added or removed, a folder removed with its files. */
  apply(changes: readonly ProjectChange[]): void {
    for (const change of changes) {
      if (!isPathInside(change.path, this.root) || change.path === this.root) continue
      const path = relative(this.root, change.path).split(sep).join('/')
      if (change.kind === 'add' && !change.folder) this.files.add(path)
      else if (change.kind === 'unlink' && !change.folder) this.files.delete(path)
      else if (change.kind === 'unlink' && change.folder) {
        const prefix = `${path}/`
        for (const file of this.files) if (file.startsWith(prefix)) this.files.delete(file)
      }
    }
  }
}

const yieldToEvents = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

const byListing = (a: FileHit, b: FileHit): number =>
  compareMatches({ score: a.score, text: a.relative }, { score: b.score, text: b.relative })

/** Puts `hit` in the sorted `best` if it ranks among the first `FILE_HIT_LIMIT`. */
function keepBest(best: FileHit[], hit: FileHit): void {
  const last = best.at(-1)
  if (best.length === FILE_HIT_LIMIT && last !== undefined && byListing(hit, last) >= 0) return
  let low = 0
  let high = best.length
  while (low < high) {
    const middle = (low + high) >>> 1
    const other = best[middle]
    if (other !== undefined && byListing(other, hit) <= 0) low = middle + 1
    else high = middle
  }
  best.splice(low, 0, hit)
  if (best.length > FILE_HIT_LIMIT) best.pop()
}

/** The best files for `query`, in chunks so a large workspace never stalls main; empty once `superseded`. */
export async function matchFiles(
  query: string,
  folders: readonly FolderFiles[],
  superseded: () => boolean = () => false
): Promise<FileHit[]> {
  // Only the best few are kept: sorting every hit of a one-letter query would block main.
  const best: FileHit[] = []
  let done = 0
  for (const folder of folders) {
    const name = basename(folder.root)
    for (const file of folder.files) {
      const match = fuzzyPathMatch(query, file)
      if (match !== null)
        keepBest(best, { path: join(folder.root, file), relative: file, folder: name, ...match })
      if (++done % CHUNK === 0) {
        await yieldToEvents()
        if (superseded()) return []
      }
    }
  }
  return best
}

/** Which of `paths` none of `folders` lists; a path in a folder whose listing failed counts as listed. */
export async function unlistedPaths(
  paths: readonly string[],
  folders: readonly { folder: FolderFiles; listed: boolean }[]
): Promise<string[]> {
  const isListed = async (path: string): Promise<boolean> => {
    const real = await realpath(path).catch(() => path)
    return folders.some(
      ({ folder, listed }) =>
        isPathInside(real, folder.root) &&
        (!listed || folder.files.has(relative(folder.root, real).split(sep).join('/')))
    )
  }
  const found = await Promise.all(paths.map(isListed))
  return paths.filter((_, index) => found[index] !== true)
}

type Indexed = { folder: FolderFiles; loaded: Promise<void>; listed: boolean; stop: () => void }

/** The workspace folders' files for Search Everywhere: listed on first use, then kept current. */
class FileIndex {
  private readonly indexed = new Map<string, Indexed>()
  private latest = 0
  private updates: Promise<void> = Promise.resolve()

  /** Follows the workspace's folders; one update at a time, so the latest read always wins. */
  update(read: () => Promise<readonly string[]>): Promise<void> {
    const next = this.updates.then(async () => this.setFolders(await read()))
    this.updates = next.catch(() => undefined)
    return next
  }

  private async setFolders(paths: readonly string[]): Promise<void> {
    const roots = await Promise.all(paths.map((path) => realpath(path).catch(() => null)))
    const wanted = new Set(roots.filter((root) => root !== null))
    for (const [root, entry] of this.indexed) {
      if (wanted.has(root)) continue
      entry.stop()
      this.indexed.delete(root)
    }
    for (const root of wanted) if (!this.indexed.has(root)) this.indexed.set(root, this.index(root))
  }

  async find(query: string): Promise<FileHit[]> {
    const id = ++this.latest
    const entries = [...this.indexed.values()]
    await Promise.all(entries.map((entry) => entry.loaded))
    if (id !== this.latest) return []
    return matchFiles(
      query,
      entries.map((entry) => entry.folder),
      () => id !== this.latest
    )
  }

  async unlisted(paths: readonly string[]): Promise<string[]> {
    const entries = [...this.indexed.values()]
    await Promise.all(entries.map((entry) => entry.loaded))
    return unlistedPaths(paths, entries)
  }

  private index(root: string): Indexed {
    const folder = new FolderFiles(root)
    // Changes heard while the listing runs are applied after it, so none is lost or undone.
    const early: ProjectChange[] = []
    let settled = false
    const watch = watchProject(root, (changes) => {
      if (settled) folder.apply(changes)
      else early.push(...changes)
    })
    // Listed once the watcher is up, so nothing changed between the two goes unseen.
    const entry: Indexed = { folder, loaded: Promise.resolve(), listed: false, stop: watch.stop }
    entry.loaded = watch.ready
      .then(() => listFiles(root))
      .then((files) => {
        for (const file of files) folder.files.add(file)
        entry.listed = true
      })
      .catch((error: unknown) =>
        console.warn(`Listing ${root} for Search Everywhere failed:`, error)
      )
      .finally(() => {
        settled = true
        folder.apply(early)
      })
    return entry
  }
}

export const fileIndex = new FileIndex()
