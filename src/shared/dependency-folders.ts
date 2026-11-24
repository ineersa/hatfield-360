/** Folders a package manager fills (npm, Composer and Go `vendor`, a virtualenv): not the project's own code. */
export const DEPENDENCY_FOLDER_NAMES = ['node_modules', 'vendor', 'venv', '.venv', 'site-packages']

const DEPENDENCY_FOLDERS = new Set(DEPENDENCY_FOLDER_NAMES)

export const isDependencyFolder = (name: string): boolean => DEPENDENCY_FOLDERS.has(name)

/** Whether `path` lies inside a dependency folder. */
export const isDependencyFile = (path: string): boolean =>
  path.split(/[/\\]/).slice(0, -1).some(isDependencyFolder)
