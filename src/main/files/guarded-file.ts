import { lstat, readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { writeFileAtomic } from './atomic-write'
import { resolveInsideRoots } from './path-containment'

const outsideRoots = (path: string): Error => new Error(`Not inside the workspace: ${path}`)

/** Reads a text file that is inside one of `roots` once symlinks are followed. */
export async function readFileInRoots(path: string, roots: string[]): Promise<string> {
  const real = await resolveInsideRoots(path, roots)
  if (real === null) throw outsideRoots(path)
  return readFile(real, 'utf8')
}

/**
 * Replaces (or creates) a text file inside one of `roots` atomically. A symlink is written through
 * to its target, which must be inside the roots too.
 */
export async function writeFileInRoots(
  path: string,
  contents: string,
  roots: string[]
): Promise<void> {
  const exists = await lstat(path).then(
    () => true,
    () => false
  )
  const folder = exists ? null : await resolveInsideRoots(dirname(path), roots)
  const real = exists
    ? await resolveInsideRoots(path, roots)
    : folder && join(folder, basename(path))
  if (!real) throw outsideRoots(path)
  await writeFileAtomic(real, contents)
}
