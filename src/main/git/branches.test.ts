import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBranch, deleteBranch, listBranches, switchBranch } from './branches'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'hatfield-branches-')))
const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM }

// The module runs git with the process environment: a config of our own, never the user's.
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
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()

const commit = (repo: string, file: string, text: string, message: string): void => {
  writeFileSync(join(repo, file), text)
  git(repo, 'add', file)
  git(repo, 'commit', '-q', '-m', message)
}

const currentBranch = (repo: string): string => git(repo, 'branch', '--show-current')
const branchNames = (repo: string): string[] =>
  git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n')

let counter = 0
/**
 * A clone of a bare remote that has `main` and `feature` (one commit ahead of main), with `main`
 * checked out and tracking origin/main.
 */
function makeClone(): { remote: string; repo: string } {
  counter += 1
  const remote = join(root, `remote-${counter}.git`)
  const seed = join(root, `seed-${counter}`)
  const repo = join(root, `repo-${counter}`)
  git(root, 'init', '-q', '--bare', remote)
  git(root, 'init', '-q', seed)
  commit(seed, 'a.txt', 'one\n', 'first')
  git(seed, 'switch', '-q', '-c', 'feature')
  commit(seed, 'b.txt', 'feature\n', 'feature work')
  git(seed, 'push', '-q', remote, 'main', 'feature')
  git(root, 'clone', '-q', remote, repo)
  return { remote, repo }
}

describe('listBranches', () => {
  it('lists the current branch first with its tracking counts, then remote branches without their HEAD', async () => {
    const { repo } = makeClone()
    git(repo, 'branch', 'zeta')
    commit(repo, 'c.txt', 'local\n', 'local work')
    const list = await listBranches(repo)
    expect(list.current).toBe('main')
    expect(list.head).toBe(git(repo, 'rev-parse', '--short', 'HEAD'))
    expect(list.local).toEqual([
      {
        name: 'main',
        current: true,
        upstream: 'origin/main',
        upstreamGone: false,
        ahead: 1,
        behind: 0,
        worktree: null
      },
      {
        name: 'zeta',
        current: false,
        upstream: null,
        upstreamGone: false,
        ahead: null,
        behind: null,
        worktree: null
      }
    ])
    expect(list.remote).toEqual([
      { name: 'origin/feature', remote: 'origin', branch: 'feature' },
      { name: 'origin/main', remote: 'origin', branch: 'main' }
    ])
  })

  it('names the worktree holding a branch, says a gone upstream and a detached HEAD', async () => {
    const { remote, repo } = makeClone()
    git(repo, 'switch', '-q', '--track', 'origin/feature')
    git(repo, 'switch', '-q', 'main')
    git(remote, 'branch', '-D', 'feature')
    git(repo, 'fetch', '-q', '--prune')
    const linked = join(root, `linked-${counter}`)
    git(repo, 'worktree', 'add', '-q', '-b', 'held', linked)
    git(repo, 'switch', '-q', '--detach')
    const list = await listBranches(repo)
    expect(list.current).toBeNull()
    expect(list.local.find((branch) => branch.name === 'held')?.worktree).toBe(linked)
    expect(list.local.find((branch) => branch.name === 'feature')).toMatchObject({
      upstream: 'origin/feature',
      upstreamGone: true,
      ahead: null,
      behind: null
    })
    expect(list.local.every((branch) => !branch.current)).toBe(true)
  })

  it('lists the unborn branch of a repository without commits', async () => {
    const repo = join(root, 'empty')
    git(root, 'init', '-q', repo)
    expect(await listBranches(repo)).toEqual({
      current: 'main',
      head: null,
      local: [
        {
          name: 'main',
          current: true,
          upstream: null,
          upstreamGone: false,
          ahead: null,
          behind: null,
          worktree: null
        }
      ],
      remote: []
    })
  })
})

describe('switchBranch', () => {
  it('switches to a local branch, and from a detached HEAD', async () => {
    const { repo } = makeClone()
    git(repo, 'branch', 'other')
    expect(await switchBranch(repo, { kind: 'local', name: 'other' })).toMatchObject({ ok: true })
    expect(currentBranch(repo)).toBe('other')
    git(repo, 'switch', '-q', '--detach')
    expect(await switchBranch(repo, { kind: 'local', name: 'main' })).toMatchObject({ ok: true })
    expect(currentBranch(repo)).toBe('main')
  })

  it('creates a tracking branch for a remote one, and reuses it the next time', async () => {
    const { repo } = makeClone()
    expect(await switchBranch(repo, { kind: 'remote', name: 'origin/feature' })).toMatchObject({
      ok: true
    })
    expect(currentBranch(repo)).toBe('feature')
    expect(git(repo, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/feature')
    git(repo, 'switch', '-q', 'main')
    expect(await switchBranch(repo, { kind: 'remote', name: 'origin/feature' })).toMatchObject({
      ok: true
    })
    expect(currentBranch(repo)).toBe('feature')
    expect(branchNames(repo)).toEqual(['feature', 'main'])
  })

  it("returns git's refusal over local changes and changes nothing", async () => {
    const { repo } = makeClone()
    git(repo, 'switch', '-q', '--track', 'origin/feature')
    git(repo, 'switch', '-q', 'main')
    writeFileSync(join(repo, 'b.txt'), 'mine\n')
    const result = await switchBranch(repo, { kind: 'local', name: 'feature' })
    expect(result.ok).toBe(false)
    expect(result.output).toContain('b.txt')
    expect(currentBranch(repo)).toBe('main')
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('mine\n')
  })

  it('refuses a branch checked out in another worktree, naming it, before git runs', async () => {
    const { repo } = makeClone()
    const linked = join(root, `linked-${counter}`)
    git(repo, 'worktree', 'add', '-q', '-b', 'held', linked)
    const result = await switchBranch(repo, { kind: 'local', name: 'held' })
    expect(result).toEqual({
      ok: false,
      output: `held is checked out in ${linked}: switch there instead, or check out another branch in it first.\n`
    })
    expect(currentBranch(repo)).toBe('main')
  })

  it('refuses a branch that is not listed, and a name git would read as an option', async () => {
    const { repo } = makeClone()
    await expect(switchBranch(repo, { kind: 'local', name: 'nope' })).rejects.toThrow(
      'There is no branch named nope.'
    )
    await expect(switchBranch(repo, { kind: 'remote', name: '--orphan' })).rejects.toThrow(
      'There is no remote branch named --orphan.'
    )
    await expect(switchBranch(repo, { kind: 'tag', name: 'main' })).rejects.toThrow(
      'Invalid branch.'
    )
  })
})

describe('createBranch', () => {
  it('creates a branch from HEAD and switches to it', async () => {
    const { repo } = makeClone()
    const result = await createBranch(repo, {
      name: 'topic/one',
      start: { kind: 'head' },
      switchTo: true
    })
    expect(result.ok).toBe(true)
    expect(currentBranch(repo)).toBe('topic/one')
  })

  it('creates a branch from another branch without switching', async () => {
    const { repo } = makeClone()
    const result = await createBranch(repo, {
      name: 'from-feature',
      start: { kind: 'remote', name: 'origin/feature' },
      switchTo: false
    })
    expect(result.ok).toBe(true)
    expect(currentBranch(repo)).toBe('main')
    expect(git(repo, 'rev-parse', 'from-feature')).toBe(git(repo, 'rev-parse', 'origin/feature'))
  })

  it('refuses an invalid or taken name before git runs', async () => {
    const { repo } = makeClone()
    const create = (name: string) =>
      createBranch(repo, { name, start: { kind: 'head' }, switchTo: true })
    expect(await create('bad..name')).toEqual({
      ok: false,
      output: 'bad..name is not a valid branch name.\n'
    })
    expect(await create('-f')).toEqual({ ok: false, output: '-f is not a valid branch name.\n' })
    expect(await create('has space')).toEqual({
      ok: false,
      output: 'has space is not a valid branch name.\n'
    })
    expect(await create('main')).toEqual({
      ok: false,
      output: 'A branch named main already exists.\n'
    })
    expect(branchNames(repo)).toEqual(['main'])
    await expect(
      createBranch(repo, { name: 'x', start: { kind: 'local', name: 'nope' }, switchTo: true })
    ).rejects.toThrow('There is no branch named nope.')
  })
})

describe('deleteBranch', () => {
  it('deletes a merged branch', async () => {
    const { repo } = makeClone()
    git(repo, 'branch', 'merged')
    expect(await deleteBranch(repo, 'merged', false)).toMatchObject({ ok: true })
    expect(branchNames(repo)).toEqual(['main'])
  })

  it('refuses an unmerged branch, naming the commits only it holds, and force deletes it', async () => {
    const { repo } = makeClone()
    git(repo, 'switch', '-q', '-c', 'work')
    commit(repo, 'w.txt', 'w\n', 'only here')
    git(repo, 'switch', '-q', 'main')
    const refused = await deleteBranch(repo, 'work', false)
    expect(refused).toMatchObject({
      ok: false,
      unmerged: {
        commits: [{ hash: git(repo, 'rev-parse', '--short', 'work'), subject: 'only here' }],
        more: 0
      }
    })
    expect(refused.output).not.toBe('')
    expect(branchNames(repo)).toEqual(['main', 'work'])
    expect(await deleteBranch(repo, 'work', true)).toMatchObject({ ok: true })
    expect(branchNames(repo)).toEqual(['main'])
  })

  it('names no lost commits for a branch merged elsewhere but not into HEAD', async () => {
    const { repo } = makeClone()
    git(repo, 'branch', '--no-track', 'copy', 'origin/feature')
    const refused = await deleteBranch(repo, 'copy', false)
    expect(refused).toMatchObject({ ok: false, unmerged: { commits: [], more: 0 } })
  })

  it('refuses the current branch and one checked out in another worktree', async () => {
    const { repo } = makeClone()
    const linked = join(root, `linked-${counter}`)
    git(repo, 'worktree', 'add', '-q', '-b', 'held', linked)
    expect(await deleteBranch(repo, 'main', true)).toEqual({
      ok: false,
      output: 'main is checked out: switch to another branch first.\n'
    })
    expect(await deleteBranch(repo, 'held', true)).toMatchObject({ ok: false })
    expect(branchNames(repo)).toEqual(['held', 'main'])
  })
})
