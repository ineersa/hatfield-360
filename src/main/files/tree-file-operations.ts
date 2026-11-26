import { lstat, mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { isPathInside, realRoots, resolveInsideRoots } from './path-containment'

const exists = (path: string): Promise<boolean> =>
  lstat(path).then(
    () => true,
    () => false
  )

/**
 * Where the entry at `path` really is, for changing the entry itself: its folder resolved inside
 * `roots`, its own name kept, so a link is renamed or trashed, not what it points at. Refuses a
 * root and any folder holding one, which would take a workspace folder or worktree with it.
 */
export async function resolveChangeableEntry(path: string, roots: string[]): Promise<string> {
  if (!isAbsolute(path)) throw new Error('Expected an absolute path')
  const real = await realRoots(roots)
  const holdsRoot = (entry: string): boolean => real.some((root) => isPathInside(root, entry))
  const holding = `${basename(path)} is or holds a workspace folder or worktree`
  const itself = await resolveInsideRoots(path, roots)
  if (itself !== null && holdsRoot(itself)) throw new Error(holding)
  const folder = await resolveInsideRoots(dirname(path), roots)
  if (folder === null) throw new Error('Not inside the workspace')
  const entry = join(folder, basename(path))
  if (!(await exists(entry))) throw new Error(`${basename(path)} no longer exists`)
  if (holdsRoot(entry)) throw new Error(holding)
  return entry
}

/** Why `name` can't be a file or folder name, or null when it can. */
export function invalidEntryName(name: string): string | null {
  if (name.trim() === '') return 'A name is required'
  if (name === '.' || name === '..') return `"${name}" is not a valid name`
  if (/[/\\\0]/.test(name)) return 'A name cannot contain / or \\'
  return null
}

/** Renames the entry at `path` to `name` in the same folder and returns its new path; never replaces another entry. */
export async function renameEntry(path: string, name: string, roots: string[]): Promise<string> {
  const problem = invalidEntryName(name)
  if (problem !== null) throw new Error(problem)
  const entry = await resolveChangeableEntry(path, roots)
  const target = join(dirname(entry), name)
  if (target === entry) return join(dirname(path), name)
  const taken = await lstat(target).catch(() => null)
  // A case-only rename on a case-insensitive disk finds the entry itself under the new name.
  if (taken !== null && taken.ino !== (await lstat(entry)).ino) {
    throw new Error(`${name} already exists`)
  }
  await rename(entry, target)
  return join(dirname(path), name)
}

/**
 * Creates an empty file or a folder named `name` in `folder` and returns its path. `name` may hold
 * `/`-separated folders, created as needed; the entry itself never replaces an existing one.
 */
export async function createEntry(
  folder: string,
  name: string,
  kind: 'file' | 'directory',
  roots: string[]
): Promise<string> {
  const names = name.split('/')
  for (const each of names) {
    const problem = invalidEntryName(each)
    if (problem !== null) throw new Error(problem)
  }
  let real = await resolveInsideRoots(folder, roots)
  if (real === null) throw new Error('Not inside the workspace')
  for (const each of names.slice(0, -1)) {
    const next = join(real, each)
    await mkdir(next).catch((error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
    })
    // An existing link on the way must not lead out of the workspace.
    real = await resolveInsideRoots(next, roots)
    if (real === null || !(await stat(real)).isDirectory())
      throw new Error(`${each} is not a folder in the workspace`)
  }
  const last = names.at(-1) ?? name
  const target = join(real, last)
  if (await exists(target)) throw new Error(`${last} already exists`)
  if (kind === 'directory') await mkdir(target)
  else await writeFile(target, '', { flag: 'wx' })
  return join(folder, ...names)
}

/** `paths` without those inside another of them: trashing a folder takes what is in it along. */
export function outermostPaths(paths: string[]): string[] {
  const unique = [...new Set(paths)]
  return unique.filter(
    (path) => !unique.some((other) => other !== path && isPathInside(path, other))
  )
}
