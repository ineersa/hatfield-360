import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseWorktreeList } from './worktree-list'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'hatfield-worktrees-')))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      ...args
    ],
    { cwd, encoding: 'utf8' }
  )
}

/** Paths as git prints them (forward slashes on Windows too). */
const gitPath = (path: string): string => path.replaceAll('\\', '/')

describe('parseWorktreeList', () => {
  it('reads every kind of worktree from real git output', () => {
    const repo = join(root, 'repo')
    git(root, 'init', '-q', '-b', 'main', repo)
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'first')
    const head = git(repo, 'rev-parse', 'HEAD').trim()
    const linked = join(root, 'with space')
    const detached = join(root, 'detached')
    const locked = join(root, 'locked')
    const gone = join(root, 'gone')
    git(repo, 'worktree', 'add', '-q', '-b', 'feature/x', linked)
    git(repo, 'worktree', 'add', '-q', '--detach', detached)
    git(repo, 'worktree', 'add', '-q', '--lock', '-b', 'held', locked)
    git(repo, 'worktree', 'add', '-q', '-b', 'old', gone)
    rmSync(gone, { recursive: true, force: true })

    const listed = parseWorktreeList(git(repo, 'worktree', 'list', '--porcelain', '-z'))

    const common = { head, bare: false, locked: false, prunable: false }
    // The main worktree comes first; git lists linked ones in its records folder's order.
    expect(listed[0]).toEqual({ ...common, path: gitPath(repo), branch: 'refs/heads/main' })
    expect(listed.slice(1).toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
      { ...common, path: gitPath(detached), branch: null },
      { ...common, path: gitPath(gone), branch: 'refs/heads/old', prunable: true },
      { ...common, path: gitPath(locked), branch: 'refs/heads/held', locked: true },
      { ...common, path: gitPath(linked), branch: 'refs/heads/feature/x' }
    ])
  })

  it('marks a bare repository', () => {
    const bare = join(root, 'bare.git')
    git(root, 'init', '-q', '--bare', bare)
    expect(parseWorktreeList(git(bare, 'worktree', 'list', '--porcelain', '-z'))).toEqual([
      { path: gitPath(bare), head: '', branch: null, bare: true, locked: false, prunable: false }
    ])
  })
})
