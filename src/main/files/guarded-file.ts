import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { writeFileAtomic } from './atomic-write'
import { resolveInsideRoots } from './path-containment'

const outsideRoots = (path: string): Error => new Error(`Not inside the workspace: ${path}`)

/**
 * Reads a text file that is inside one of `roots` once symlinks are followed, with `real`, the file
 * it was read from.
 */
export async function readFileInRoots(
  path: string,
  roots: string[]
): Promise<{ text: string; real: string }> {
  const real = await resolveInsideRoots(path, roots)
  if (real === null) throw outsideRoots(path)
  return { text: await readFile(real, 'utf8'), real }
}

/**
 * Replaces the file at `path` only while it still is `real`, the file it was read from, wherever the
 * workspace's folders are now. A path since replaced by a link to another file is refused.
 */
export async function writeFileReadAs(path: string, contents: string, real: string): Promise<void> {
  const current = await realpath(path).catch(() => null)
  if (current !== real) throw outsideRoots(path)
  await writeFileAtomic(real, contents)
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
  // Checked before writing: the temp file would go next to a folder, which for a root is outside.
  if (exists && (await stat(real)).isDirectory()) throw new Error(`Not a file: ${path}`)
  await writeFileAtomic(real, contents)
}
