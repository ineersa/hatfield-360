import { lstat, realpath } from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  type PlatformPath,
  posix,
  resolve,
  win32
} from 'node:path'

const platformPath: PlatformPath = process.platform === 'win32' ? win32 : posix

/** Whether `child` is `parent` or inside it, by path alone (case-insensitive on Windows). */
export function isPathInside(
  child: string,
  parent: string,
  paths: PlatformPath = platformPath
): boolean {
  const relative = paths.relative(parent, child)
  return (
    relative === '' ||
    (!paths.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${paths.sep}`))
  )
}

const realpathOrNull = (path: string): Promise<string | null> => realpath(path).catch(() => null)

/** Where each of `roots` really is, leaving out those that no longer exist. */
export async function realRoots(roots: string[]): Promise<string[]> {
  const real = await Promise.all(roots.map(realpathOrNull))
  return real.filter((root) => root !== null)
}

/**
 * The real location of `path` when it is inside one of `roots` after following every symlink, or
 * null. Relative paths are refused: the renderer always sends paths it got from main.
 */
export async function resolveInsideRoots(path: string, roots: string[]): Promise<string | null> {
  if (!isAbsolute(path)) return null
  const [real, inside] = await Promise.all([realpathOrNull(resolve(path)), realRoots(roots)])
  if (real === null) return null
  return inside.some((root) => isPathInside(real, root)) ? real : null
}

/**
 * Where `path` really is when it is inside `roots`, or null: an existing path (a link followed to
 * its target) as `resolveInsideRoots` finds it, and a path not created yet by its folder's real
 * location. A link that leads nowhere is refused: what it would create is wherever it points.
 */
export async function resolveTargetInsideRoots(
  path: string,
  roots: string[]
): Promise<string | null> {
  if (!isAbsolute(path)) return null
  const exists = await lstat(path).then(
    () => true,
    () => false
  )
  if (exists) return resolveInsideRoots(path, roots)
  const folder = await resolveInsideRoots(dirname(path), roots)
  return folder === null ? null : join(folder, basename(path))
}

/** `path` from the innermost root it is under, by path alone; null for a root itself or outside them all. */
export function rootRelativePath(
  path: string,
  roots: string[],
  paths: PlatformPath = platformPath
): string | null {
  const root = roots
    .filter((candidate) => isPathInside(path, candidate, paths))
    .toSorted((a, b) => b.length - a.length)[0]
  if (root === undefined) return null
  const relative = paths.relative(root, path)
  return relative === '' ? null : relative
}
