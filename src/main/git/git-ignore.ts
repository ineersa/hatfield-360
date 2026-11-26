import { join } from 'node:path'
import { runGit } from './git-command'

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
 * nothing when git can't say.
 */
export async function ignoredPaths(folder: string): Promise<string[]> {
  return (await ignoredEntries(folder)).map((path) => join(folder, path.replace(/\/$/, '')))
}

/** The wholly ignored folders of `ignoredPaths`, without its single files. */
export async function ignoredFolders(folder: string): Promise<string[]> {
  return (await ignoredEntries(folder))
    .filter((path) => path.endsWith('/'))
    .map((path) => join(folder, path.slice(0, -1)))
}

/** `git ls-files`' ignored entries, relative with `/`; a folder's ends with `/`. */
async function ignoredEntries(folder: string): Promise<string[]> {
  try {
    const output = await runGit(folder, [
      'ls-files',
      '--others',
      '--ignored',
      '--exclude-standard',
      '--directory',
      '-z'
    ])
    return output.split('\0').filter((path) => path !== '')
  } catch {
    return []
  }
}
