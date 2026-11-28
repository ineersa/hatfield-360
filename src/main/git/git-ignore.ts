import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
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

/**
 * What git ignores under `folder`, each wholly ignored folder named once instead of its contents;
 * nothing when git can't say. A folder that isn't a repository (a multi-repo folder) gets what each
 * repository directly inside it ignores.
 */
export async function ignoredPaths(folder: string): Promise<string[]> {
  try {
    return await repositoryIgnoredPaths(folder)
  } catch (error) {
    if (!(error instanceof GitError) || error.reason !== 'not-git') return []
    const names = await readdir(folder).catch((): string[] => [])
    const inside = await Promise.all(
      names.map(async (name) => {
        const path = join(folder, name)
        const repository = await lstat(join(path, '.git')).then(
          () => true,
          () => false
        )
        return repository ? repositoryIgnoredPaths(path).catch((): string[] => []) : []
      })
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
