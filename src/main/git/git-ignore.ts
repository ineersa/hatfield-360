import { join } from 'node:path'
import { mapWithConcurrency } from '../../shared/limited-concurrency'
import { GitError, runGit } from './git-command'

/** Names in `folder` that git ignores; none when git can't say (not a repository, a submodule's files). */
export async function ignoredNames(folder: string, names: string[]): Promise<Set<string>> {
  if (names.length === 0) return new Set()
  try {
    const output = await runGit(folder, ['check-ignore', '--stdin', '-z'], {
      input: `${names.join('\0')}\0`,
      okExitCodes: [1]
    })
    return new Set(output.split('\0').filter((name) => name !== ''))
  } catch {
    return new Set()
  }
}

/** A multi-repo folder may hold dozens of working trees; each listing walks its untracked files. */
const IGNORE_CONCURRENCY = 8

/**
 * What git ignores under `folder`, each wholly ignored folder named once instead of its contents;
 * nothing when git can't say.
 */
export async function ignoredPaths(folder: string, workingTrees: string[] = []): Promise<string[]> {
  try {
    return await repositoryIgnoredPaths(folder)
  } catch (error) {
    if (!(error instanceof GitError) || error.reason !== 'not-git') return []
    const inside = await mapWithConcurrency(workingTrees, IGNORE_CONCURRENCY, (path) =>
      repositoryIgnoredPaths(path).catch((): string[] => [])
    )
    return inside.flat()
  }
}

async function repositoryIgnoredPaths(folder: string): Promise<string[]> {
  const output = await runGit(folder, [
    'ls-files',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
    '-z'
  ])
  return output
    .split('\0')
    .filter((path) => path !== '')
    .map((path) => join(folder, path.replace(/\/$/, '')))
}

/**
 * A .gitignore line matching only the file at `path` (repository-relative, `/`-separated): anchored
 * by a leading `/`, which also keeps a `#` or `!` in the name from starting a comment or negation,
 * with glob characters, backslashes and trailing spaces escaped.
 */
export function anchoredIgnorePattern(path: string): string {
  if (/[\r\n]/.test(path)) throw new Error(`${path} can't be written to .gitignore.`)
  const escaped = path.replace(/[\\*?[]/g, (char) => `\\${char}`)
  return `/${escaped.replace(/ +$/, (spaces) => '\\ '.repeat(spaces.length))}`
}
