import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DirectoryEntry, DirectoryListing } from '../../shared/file-tree-api'
import { runGit } from '../git/git-command'
import type { FileRoot } from './file-roots'
import { isPathInside, resolveInsideRoots } from './path-containment'

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The root a path belongs to: the innermost, since a worktree can sit inside its project. */
function owningRoot(path: string, roots: FileRoot[]): FileRoot | undefined {
  return roots
    .filter((root) => isPathInside(path, root.path))
    .toSorted((a, b) => b.path.length - a.path.length)[0]
}

async function entryKind(folder: string, entry: Dirent): Promise<DirectoryEntry['kind']> {
  if (entry.isDirectory()) return 'directory'
  if (!entry.isSymbolicLink()) return 'file'
  // A broken link is listed as a file.
  return stat(join(folder, entry.name)).then(
    (info) => (info.isDirectory() ? 'directory' : 'file'),
    () => 'file'
  )
}

/** Names in `folder` that git ignores; none when git can't say (not a repository, a submodule's files). */
async function ignoredNames(folder: string, names: string[]): Promise<Set<string>> {
  if (names.length === 0) return new Set()
  try {
    const output = await runGit(folder, ['check-ignore', '--stdin', '-z'], {
      input: `${names.join('\0')}\0`,
      okExitCodes: [1]
    })
    return new Set(output.split('\0').filter((name) => name !== ''))
  } catch {
    return new Set()
  }
}

/** Lists a folder inside the roots: folders first, then files, each sorted by name. */
export async function listDirectory(path: string, roots: FileRoot[]): Promise<DirectoryListing> {
  const real = await resolveInsideRoots(
    path,
    roots.map((root) => root.path)
  )
  if (real === null) return { path, status: 'error', message: 'Not inside the workspace' }
  let dirents: Dirent[]
  try {
    dirents = await readdir(real, { withFileTypes: true })
  } catch (error) {
    return { path, status: 'error', message: message(error) }
  }
  const names = dirents.map((entry) => entry.name)
  const [kinds, ignored] = await Promise.all([
    Promise.all(dirents.map((entry) => entryKind(real, entry))),
    owningRoot(path, roots)?.git ? ignoredNames(real, names) : Promise.resolve(null)
  ])
  const entries = dirents.map((entry, index): DirectoryEntry => ({
    name: entry.name,
    path: join(path, entry.name),
    kind: kinds[index] ?? 'file',
    symlink: entry.isSymbolicLink(),
    ignored: ignored !== null && (entry.name === '.git' || ignored.has(entry.name))
  }))
  entries.sort((a, b) =>
    a.kind === b.kind ? byName.compare(a.name, b.name) : a.kind === 'directory' ? -1 : 1
  )
  return { path, status: 'ok', entries }
}
