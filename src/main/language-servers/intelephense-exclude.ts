import { relative, sep } from 'node:path'
import { isDependencyFile, isDependencyFolder } from '../../shared/dependency-folders'

/** Intelephense's own `files.exclude`, which a configured one replaces rather than adds to. */
const INTELEPHENSE_DEFAULT_EXCLUDE = [
  '**/.git/**',
  '**/.svn/**',
  '**/.hg/**',
  '**/CVS/**',
  '**/.DS_Store/**',
  '**/node_modules/**',
  '**/bower_components/**',
  '**/vendor/**/{Tests,tests}/**',
  '**/.history/**',
  '**/vendor/**/vendor/**'
]

const escapeGlob = (path: string): string => path.replace(/[\\*?[\]{}()!+@]/g, '\\$&')

/**
 * Intelephense's `files.exclude` for `root`: its defaults plus the folders git ignores (caches, build
 * output), as JetBrains excludes them. Dependency folders stay indexed: Go to Definition needs them.
 */
export function intelephenseExclude(root: string, ignoredFolders: readonly string[]): string[] {
  const excluded = ignoredFolders.filter((folder) => {
    const path = relative(root, folder)
    if (path === '' || path.startsWith('..')) return false
    const name = path.split(sep).at(-1) ?? ''
    return !isDependencyFolder(name) && !isDependencyFile(path)
  })
  return [
    ...INTELEPHENSE_DEFAULT_EXCLUDE,
    ...excluded.map((folder) => `${escapeGlob(folder.split(sep).join('/'))}/**`)
  ]
}
