import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { WorktreeStore } from './worktree-store'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'hatfield-worktree-store-')))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function git(cwd: string, ...args: string[]): void {
  execFileSync(
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
    { cwd, stdio: 'ignore' }
  )
}

function makeRepo(name: string): string {
  const repo = join(root, name)
  git(root, 'init', '-q', '-b', 'main', repo)
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'first')
  return repo
}

let store: WorktreeStore | null = null
afterEach(() => {
  void store?.setFolders([])
  store = null
})

async function follow(folder: string): Promise<WorktreeStore> {
  store = new WorktreeStore()
  await store.setFolders([folder])
  return store
}

/** The linked worktrees' folder names the store lists for its one project, or its status. */
function listed(watched: WorktreeStore): string[] | string {
  const project = watched.view()[0]
  if (project?.status !== 'git') return project?.status ?? 'none'
  return project.worktrees.filter((worktree) => !worktree.project).map((worktree) => worktree.name)
}

// The store follows file system events; each step waits for git's change to show, never a fixed time.
const settles = { timeout: 3000 }

describe('WorktreeStore follows git', { timeout: 20_000 }, () => {
  it('keeps finding worktrees after the last linked one was removed', async () => {
    const repo = makeRepo('readd')
    const watched = await follow(repo)
    git(repo, 'worktree', 'add', '-q', '--detach', join(root, 'readd-a'))
    await expect.poll(() => listed(watched), settles).toEqual(['readd-a'])
    // Removing the last one deletes .git/worktrees; adding recreates it.
    git(repo, 'worktree', 'remove', join(root, 'readd-a'))
    await expect.poll(() => listed(watched), settles).toEqual([])
    git(repo, 'worktree', 'add', '-q', '--detach', join(root, 'readd-b'))
    await expect.poll(() => listed(watched), settles).toEqual(['readd-b'])
    git(repo, 'worktree', 'add', '-q', '--detach', join(root, 'readd-c'))
    await expect.poll(() => listed(watched), settles).toEqual(['readd-b', 'readd-c'])
  })

  it('recovers when a broken repository is fixed, also one broken before it was followed', async () => {
    const repo = makeRepo('broken')
    const head = join(repo, '.git', 'HEAD')
    const watched = await follow(repo)
    writeFileSync(head, 'not a ref\n')
    await expect.poll(() => listed(watched), settles).toBe('error')
    writeFileSync(head, 'ref: refs/heads/main\n')
    await expect.poll(() => listed(watched), settles).toEqual([])

    writeFileSync(head, 'not a ref\n')
    const later = await follow(repo)
    expect(listed(later)).toBe('error')
    writeFileSync(head, 'ref: refs/heads/main\n')
    await expect.poll(() => listed(later), settles).toEqual([])
  })

  it("sees a bare repository's first linked worktree", async () => {
    const bare = join(root, 'bare.git')
    git(root, 'init', '-q', '--bare', '-b', 'main', bare)
    const seed = makeRepo('seed')
    git(seed, 'push', '-q', bare, 'main')
    const watched = await follow(bare)
    expect(listed(watched)).toEqual([])
    git(bare, 'worktree', 'add', '-q', '--detach', join(root, 'bare-feature'))
    await expect.poll(() => listed(watched), settles).toEqual(['bare-feature'])
  })
})
