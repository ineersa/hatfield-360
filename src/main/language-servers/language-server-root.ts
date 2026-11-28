import { join, relative, sep } from 'node:path'
import { isPathInside } from '../files/path-containment'

/**
 * The folder a server indexes for `file` in a multi-repo `folder`: the deepest repository working
 * tree holding it, else the subfolder of `folder` holding it; null for a file directly in `folder`,
 * which would otherwise index every repository at once. All paths are real.
 */
export function multiRepoServerRoot(
  file: string,
  folder: string,
  trees: readonly string[]
): string | null {
  const [tree] = trees
    .filter((each) => isPathInside(file, each))
    .toSorted((a, b) => b.length - a.length)
  if (tree !== undefined) return tree
  const [child, ...rest] = relative(folder, file).split(sep)
  return child === undefined || child === '' || rest.length === 0 ? null : join(folder, child)
}
