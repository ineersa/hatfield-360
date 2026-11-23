import { isPathInside } from '../files/path-containment'

/** An install's `lib/pythonX.Y` tree, or a `site-packages`/`dist-packages` folder. */
const PYTHON_LIBRARY = /[/\\](lib[/\\]python\d+(\.\d+)?|site-packages|dist-packages)([/\\]|$)/

/**
 * Library folders the editor may read from, given as real paths with the real home folder: never
 * home itself or a folder above it, which would open every file in home (keys, tokens) to the page.
 */
export function libraryFoldersBesideHome(folders: string[], home: string): string[] {
  return folders.filter((folder) => !isPathInside(home, folder))
}

/**
 * Whether a folder on Python's search path (a real path) counts as Python's library: anything
 * outside home, and inside it only Python's own folders (pyenv, `~/.local`, a virtualenv), not
 * whatever folder `PYTHONPATH` happens to name.
 */
export function isPythonLibraryFolder(folder: string, home: string): boolean {
  return !isPathInside(folder, home) || PYTHON_LIBRARY.test(folder)
}
