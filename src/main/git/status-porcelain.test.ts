import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseStatus, STATUS_ARGS, type StatusEntry } from './status-porcelain'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'hatfield-status-porcelain-')))
const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM }

// Git runs with the process environment: a config of our own, never the user's.
beforeAll(() => {
  const config = join(root, 'gitconfig')
  writeFileSync(
    config,
    '[user]\n\tname = Test\n\temail = test@example.com\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n'
  )
  process.env.GIT_CONFIG_GLOBAL = config
  process.env.GIT_CONFIG_NOSYSTEM = '1'
})

afterAll(() => {
  if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL
  else process.env.GIT_CONFIG_GLOBAL = saved.global
  if (saved.system === undefined) delete process.env.GIT_CONFIG_NOSYSTEM
  else process.env.GIT_CONFIG_NOSYSTEM = saved.system
  rmSync(root, { recursive: true, force: true })
})

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })

/** Like `git`, for a command that is meant to fail (a conflicting merge). */
const gitFailing = (cwd: string, ...args: string[]): void => {
  expect(() => git(cwd, ...args)).toThrow('Command failed')
}

const write = (repo: string, path: string, text: string): void => {
  mkdirSync(dirname(join(repo, path)), { recursive: true })
  writeFileSync(join(repo, path), text)
}

let repos = 0
/** A new repository with one commit of `files`. */
function repository(files: Record<string, string> = { 'base.txt': 'base\n' }): string {
  repos += 1
  const repo = join(root, `repo-${repos}`)
  git(root, 'init', '-q', repo)
  for (const [path, text] of Object.entries(files)) write(repo, path, text)
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'base')
  return repo
}

const status = (repo: string) => parseStatus(git(repo, ...STATUS_ARGS))

const entry = (path: string, kind: StatusEntry['kind'], more: Partial<StatusEntry> = {}) => ({
  path,
  originalPath: null,
  kind,
  nestedRepository: false,
  ...more
})

const byPath = (entries: StatusEntry[]): StatusEntry[] =>
  entries.toSorted((a, b) => a.path.localeCompare(b.path))

describe('parseStatus', () => {
  it('reads modified, staged, added, deleted and renamed files, and copies with their original path', () => {
    const repo = repository({ 'm.txt': 'm\n', 'd.txt': 'd\n', 'old.txt': 'o\n', 's.txt': 's\n' })
    write(repo, 'm.txt', 'changed\n')
    rmSync(join(repo, 'd.txt'))
    git(repo, 'mv', 'old.txt', 'new name.txt')
    write(repo, 's.txt', 'staged\n')
    git(repo, 'add', 's.txt')
    write(repo, 'a.txt', 'added\n')
    git(repo, 'add', 'a.txt')
    write(repo, 'copy.txt', 's\n')
    git(repo, 'add', 'copy.txt')
    // Status finds a copy only of a file changed in the index.
    git(repo, 'config', 'status.renames', 'copies')

    expect(byPath(status(repo).entries)).toEqual([
      entry('a.txt', 'added'),
      entry('copy.txt', 'added', { originalPath: 's.txt' }),
      entry('d.txt', 'deleted'),
      entry('m.txt', 'modified'),
      entry('new name.txt', 'renamed', { originalPath: 'old.txt' }),
      entry('s.txt', 'modified')
    ])
  })

  it('keeps untracked paths exactly as they are: spaces, trailing spaces, newlines, quotes, unicode, arrows', () => {
    const repo = repository()
    const paths = ['dir/x y.ts', 'trail ', 'new\nline', 'q"uo\'te', 'ünï cödé', 'a -> b', ' lead']
    for (const path of paths) write(repo, path, 'u\n')

    expect(byPath(status(repo).entries)).toEqual(
      byPath(paths.map((path) => entry(path, 'untracked')))
    )
  })

  it('lists an untracked nested repository and an inner worktree as one folder each', () => {
    const repo = repository()
    git(repo, 'init', '-q', 'vendor/lib')
    git(repo, 'worktree', 'add', '-q', '-b', 'inner', 'inner tree')
    write(repo, 'vendor/file.txt', 'f\n')

    expect(byPath(status(repo).entries)).toEqual([
      entry('inner tree', 'untracked', { nestedRepository: true }),
      entry('vendor/file.txt', 'untracked'),
      entry('vendor/lib', 'untracked', { nestedRepository: true })
    ])
  })

  it('reads every kind of unmerged entry as conflicted', () => {
    const repo = repository({
      'both.txt': 'base\n',
      'ours-deleted.txt': 'base\n',
      'theirs-deleted.txt': 'base\n'
    })
    git(repo, 'checkout', '-q', '-b', 'theirs')
    write(repo, 'both.txt', 'theirs\n')
    git(repo, 'rm', '-q', 'ours-deleted.txt')
    write(repo, 'theirs-deleted.txt', 'theirs\n')
    write(repo, 'added-both.txt', 'theirs\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'theirs')
    git(repo, 'checkout', '-q', 'main')
    write(repo, 'both.txt', 'ours\n')
    write(repo, 'ours-deleted.txt', 'ours\n')
    git(repo, 'rm', '-q', 'theirs-deleted.txt')
    write(repo, 'added-both.txt', 'ours\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'ours')
    gitFailing(repo, 'merge', 'theirs')
    const renames = repository({ 'a.txt': 'a\n' })
    git(renames, 'checkout', '-q', '-b', 'one')
    git(renames, 'mv', 'a.txt', 'b.txt')
    git(renames, 'commit', '-q', '-m', 'one')
    git(renames, 'checkout', '-q', '-b', 'two', 'main')
    git(renames, 'mv', 'a.txt', 'c.txt')
    git(renames, 'commit', '-q', '-m', 'two')
    gitFailing(renames, 'merge', 'one')

    // Both sides renaming one file gives the other three kinds: DD, UA and AU.
    const codes = (cwd: string) =>
      git(cwd, 'status', '--short')
        .split('\n')
        .filter(Boolean)
        .map((line) => line.slice(0, 2))
        .toSorted()
    expect(codes(repo)).toEqual(['AA', 'DU', 'UD', 'UU'])
    expect(codes(renames)).toEqual(['AU', 'DD', 'UA'])
    expect(byPath(status(repo).entries)).toEqual([
      entry('added-both.txt', 'conflicted'),
      entry('both.txt', 'conflicted'),
      entry('ours-deleted.txt', 'conflicted'),
      entry('theirs-deleted.txt', 'conflicted')
    ])
    expect(byPath(status(renames).entries)).toEqual([
      entry('a.txt', 'conflicted'),
      entry('b.txt', 'conflicted'),
      entry('c.txt', 'conflicted')
    ])
  })
})

describe('parseStatus branch', () => {
  it('names a branch without commits, and no branch for a detached HEAD', () => {
    const unborn = join(root, 'unborn')
    git(root, 'init', '-q', '-b', 'first', unborn)
    write(unborn, 'a.txt', 'a\n')
    git(unborn, 'add', 'a.txt')
    const detached = repository()
    git(detached, 'checkout', '-q', '--detach')

    expect(status(unborn)).toEqual({
      branch: 'first',
      upstream: null,
      ahead: null,
      behind: null,
      entries: [entry('a.txt', 'added')]
    })
    expect(status(detached)).toMatchObject({ branch: null, upstream: null, ahead: null })
  })

  it('counts commits ahead of and behind the upstream, and none once the upstream branch is gone', () => {
    const remote = join(root, 'remote.git')
    git(root, 'init', '-q', '--bare', remote)
    const repo = repository()
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    const other = join(root, 'other')
    git(root, 'clone', '-q', remote, other)
    git(other, 'commit', '-q', '--allow-empty', '-m', 'theirs')
    git(other, 'push', '-q')
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'one')
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'two')
    git(repo, 'fetch', '-q')

    expect(status(repo)).toMatchObject({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1
    })
    git(remote, 'branch', '-m', 'main', 'renamed')
    git(repo, 'fetch', '-q', '--prune')
    expect(status(repo)).toMatchObject({ upstream: 'origin/main', ahead: 0, behind: 0 })
  })
})
