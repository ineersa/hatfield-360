import { lstat, realpath, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { writeFileAtomic } from './atomic-write'
import { resolveInsideRoots, resolveTargetInsideRoots } from './path-containment'

const outsideRoots = (path: string): Error => new Error(`Not inside the workspace: ${path}`)

/**
 * The real file the editor may read `path` from: one inside `roots` once symlinks are followed, or
 * `held`, the file it was read from before, while the path still leads there. Null when nothing is
 * at the path and saying so reveals nothing new: the path is held, or its folder is in the roots.
 */
export async function locateEditorFile(
  path: string,
  roots: string[],
  held: string | undefined
): Promise<string | null> {
  const inside = await resolveInsideRoots(path, roots)
  if (inside !== null) return inside
  const exists = await lstat(path).then(
    () => true,
    () => false
  )
  if (!exists) {
    if (held !== undefined || (await resolveInsideRoots(dirname(path), roots)) !== null) return null
    throw outsideRoots(path)
  }
  if (held !== undefined && (await realpath(path).catch(() => null)) === held) return held
  throw outsideRoots(path)
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
  const real = await resolveTargetInsideRoots(path, roots)
  if (!real) throw outsideRoots(path)
  // Checked before writing: the temp file would go next to a folder, which for a root is outside.
  if ((await stat(real).catch(() => null))?.isDirectory()) throw new Error(`Not a file: ${path}`)
  await writeFileAtomic(real, contents)
}
