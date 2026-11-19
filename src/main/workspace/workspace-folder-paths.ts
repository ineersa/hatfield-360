import { posix, win32, type PlatformPath } from 'node:path'

const platformPath: PlatformPath = process.platform === 'win32' ? win32 : posix

/**
 * How a folder is written into a workspace file: relative (with `/`) when it is inside the file's
 * directory, so a workspace file kept in a repo still works after the repo moves; absolute otherwise.
 */
export function toStoredFolderPath(
  folder: string,
  workspaceFile: string,
  paths: PlatformPath = platformPath
): string {
  const relative = paths.relative(paths.dirname(workspaceFile), folder)
  if (relative === '') return '.'
  const outside =
    paths.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${paths.sep}`)
  return outside ? folder : relative.split(paths.sep).join('/')
}

/** The absolute folder path for a path read from a workspace file. */
export function fromStoredFolderPath(
  stored: string,
  workspaceFile: string,
  paths: PlatformPath = platformPath
): string {
  return paths.resolve(paths.dirname(workspaceFile), stored)
}
