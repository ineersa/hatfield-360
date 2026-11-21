import { realpath } from 'node:fs/promises'
import { isAbsolute, type PlatformPath, posix, resolve, win32 } from 'node:path'

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

/**
 * The real location of `path` when it is inside one of `roots` after following every symlink, or
 * null. Relative paths are refused: the renderer always sends paths it got from main.
 */
export async function resolveInsideRoots(path: string, roots: string[]): Promise<string | null> {
  if (!isAbsolute(path)) return null
  const [real, ...realRoots] = await Promise.all([
    realpathOrNull(resolve(path)),
    ...roots.map(realpathOrNull)
  ])
  if (real === null || real === undefined) return null
  return realRoots.some((root) => root !== null && isPathInside(real, root)) ? real : null
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
