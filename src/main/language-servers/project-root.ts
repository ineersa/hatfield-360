import { access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isPathInside } from '../files/path-containment'

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  )

/**
 * The nearest folder above `file`, up to `folder` (the workspace folder holding it), that holds one
 * of `markers`; `folder` itself when none does.
 */
export async function projectRoot(
  file: string,
  folder: string,
  markers: string[]
): Promise<string> {
  for (let current = dirname(file); isPathInside(current, folder); current = dirname(current)) {
    const found = await Promise.all(markers.map((marker) => exists(join(current, marker))))
    if (found.includes(true)) return current
    if (dirname(current) === current) break
  }
  return folder
}
