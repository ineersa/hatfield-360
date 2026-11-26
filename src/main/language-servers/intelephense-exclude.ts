import { isDependencyFolder } from '../../shared/dependency-folders'
import type { IgnoreRule } from '../git/ignore-rules'

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

const inDependency = (path: string): boolean => path.split('/').some(isDependencyFolder)

/**
 * Intelephense's `files.exclude`: its defaults plus git's ignore rules (caches, build output), as
 * JetBrains excludes them. Rules, not the folders they match now, so a folder created later is
 * excluded too and the list only changes with the rules. Dependency folders stay indexed: Go to
 * Definition needs them.
 */
export function intelephenseExclude(root: string, rules: readonly IgnoreRule[]): string[] {
  const kept = rules.filter(
    (rule) =>
      !inDependency(rule.pattern) &&
      !(rule.base.startsWith(`${root}/`) && inDependency(rule.base.slice(root.length + 1)))
  )
  return [...new Set([...INTELEPHENSE_DEFAULT_EXCLUDE, ...kept.flatMap((rule) => rule.globs)])]
}
