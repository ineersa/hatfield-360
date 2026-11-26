import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { runGit } from './git-command'

/** One ignore rule as globs over absolute paths, for tools that take globs rather than git's answer. */
export type IgnoreRule = {
  /** The folder its file is in; the repository's top for `info/exclude` and the user's own file. */
  base: string
  /** The rule without its leading and trailing `/`. */
  pattern: string
  globs: string[]
}

const escapeGlob = (path: string): string => path.replace(/[\\*?[\]{}()!+@]/g, '\\$&')

/**
 * The rules of a `.gitignore`-style `text` whose patterns are relative to `base`. A negated rule
 * (`!keep.php`) can't be expressed as an excluding glob, so it is left out: what it re-includes
 * stays ignored here.
 */
export function ignoreRules(base: string, text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = []
  for (const line of text.split(/\r?\n/)) {
    let pattern = line.replace(/(?<!\\)\s+$/, '')
    if (pattern === '' || pattern.startsWith('#') || pattern.startsWith('!')) continue
    if (pattern.startsWith('\\#') || pattern.startsWith('\\!')) pattern = pattern.slice(1)
    const folderOnly = pattern.endsWith('/')
    pattern = pattern.replace(/\/+$/, '')
    // A slash before the end ties the pattern to `base`; without one it matches at any depth.
    const anchored = pattern.includes('/')
    pattern = pattern.replace(/^\//, '')
    if (pattern === '') continue
    const glob = `${escapeGlob(base)}/${anchored ? '' : '**/'}${pattern}`
    rules.push({ base, pattern, globs: folderOnly ? [`${glob}/**`] : [glob, `${glob}/**`] })
  }
  return rules
}

const read = (path: string): Promise<string> => readFile(path, 'utf8').catch(() => '')

/**
 * Every ignore rule git applies inside `root`: its `.gitignore` files (but those in ignored folders,
 * which git doesn't read), the ones above it up to the repository's top, `info/exclude` and the
 * user's own excludes file. None when `root` isn't in a repository.
 */
export async function gitIgnoreRules(root: string): Promise<IgnoreRule[]> {
  let top: string
  try {
    top = (await runGit(root, ['rev-parse', '--show-toplevel'])).trim()
  } catch {
    return []
  }
  const files: { base: string; path: string }[] = []
  for (
    let folder = dirname(root);
    relative(top, folder) !== '' && !relative(top, folder).startsWith('..');
    folder = dirname(folder)
  )
    files.push({ base: folder, path: join(folder, '.gitignore') })
  if (root !== top) files.push({ base: top, path: join(top, '.gitignore') })
  const inside = await runGit(root, [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    ':(glob)**/.gitignore'
  ]).catch(() => '')
  for (const path of inside.split('\0').filter((each) => each !== ''))
    files.push({ base: dirname(join(root, path)), path: join(root, path) })
  const exclude = await runGit(root, ['rev-parse', '--git-path', 'info/exclude']).catch(() => '')
  if (exclude.trim() !== '') files.push({ base: top, path: resolve(root, exclude.trim()) })
  const userFile = await runGit(root, ['config', '--path', '--get', 'core.excludesFile'], {
    okExitCodes: [1]
  }).catch(() => '')
  files.push({
    base: top,
    path:
      userFile.trim() ||
      join(process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), 'git', 'ignore')
  })
  const texts = await Promise.all(files.map((file) => read(file.path)))
  return files.flatMap((file, index) => ignoreRules(file.base, texts[index] ?? ''))
}
