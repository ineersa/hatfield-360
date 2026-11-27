import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dropStash, listStashes, stashChanges, stashToShow, unstash } from './stash'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'hatfield-stash-')))
const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM }

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

const git = (repo: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()

const read = (repo: string, name: string): string => readFileSync(join(repo, name), 'utf8')

let count = 0
/** A repository with a.txt, b.txt, c.txt and old.txt committed on `main`. */
function makeRepo(): string {
  const repo = join(root, `repo-${count++}`)
  git(root, 'init', '-q', repo)
  for (const name of ['a.txt', 'b.txt', 'c.txt', 'old.txt'])
    writeFileSync(join(repo, name), `${name}\n`)
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'Add the files')
  return repo
}

/** Untrimmed: a line's leading space says the change isn't staged. */
const status = (repo: string): string[] =>
  execFileSync('git', ['status', '--porcelain=v1', '-uall'], { cwd: repo, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)

describe('stashChanges', () => {
  it('stashes only the chosen files, a rename on both sides, and leaves the rest staged or not', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'a changed\n')
    writeFileSync(join(repo, 'b.txt'), 'b staged\n')
    git(repo, 'add', 'b.txt')
    writeFileSync(join(repo, 'c.txt'), 'c kept\n')
    git(repo, 'add', 'c.txt')
    git(repo, 'mv', 'old.txt', 'new.txt')
    const result = await stashChanges(repo, {
      paths: ['a.txt', 'b.txt', 'new.txt'],
      untracked: [],
      message: '  half done  '
    })
    expect(result).toMatchObject({ ok: true })
    // c.txt stays staged; the stashed files are back to HEAD, the rename undone.
    expect(status(repo)).toEqual(['M  c.txt'])
    expect(read(repo, 'a.txt')).toBe('a.txt\n')
    expect(existsSync(join(repo, 'old.txt'))).toBe(true)
    expect(existsSync(join(repo, 'new.txt'))).toBe(false)
    const [entry] = await listStashes(repo)
    expect(entry).toMatchObject({ branch: 'main', message: 'half done' })
    expect(entry?.id).toMatch(/^[0-9a-f]{40}$/)
    const stashed = git(
      repo,
      'stash',
      'show',
      '--no-renames',
      '--name-status',
      '--format=',
      'stash@{0}'
    )
    expect(stashed.split('\n')).toEqual(
      expect.arrayContaining(['M\ta.txt', 'M\tb.txt', 'A\tnew.txt', 'D\told.txt'])
    )
    // Popping it brings the chosen changes back, the rename too. The stash's index also holds the
    // still staged c.txt, so the staging can't be restored: they come back unstaged.
    expect(await unstash(repo, entry?.id, true)).toMatchObject({ ok: true })
    expect(read(repo, 'a.txt')).toBe('a changed\n')
    expect(read(repo, 'b.txt')).toBe('b staged\n')
    expect(status(repo)).toEqual([' M a.txt', ' M b.txt', 'M  c.txt', 'A  new.txt', ' D old.txt'])
    expect(await listStashes(repo)).toEqual([])
  })

  it('brings back what was staged as staged when the index allows', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'a changed\n')
    writeFileSync(join(repo, 'b.txt'), 'b staged\n')
    git(repo, 'add', 'b.txt')
    await stashChanges(repo, { paths: ['a.txt', 'b.txt'], untracked: [], message: 'both' })
    expect(status(repo)).toEqual([])
    const [entry] = await listStashes(repo)
    expect(await unstash(repo, entry?.id, false)).toMatchObject({ ok: true })
    expect(status(repo)).toEqual([' M a.txt', 'M  b.txt'])
  })

  it('leaves the staging as it was when the stash fails', async () => {
    const repo = makeRepo()
    // A conflicted merge elsewhere: git can't save the index, so the stash fails.
    git(repo, 'switch', '-q', '-c', 'side')
    writeFileSync(join(repo, 'a.txt'), 'side\n')
    git(repo, 'commit', '-q', '-am', 'Side')
    git(repo, 'switch', '-q', 'main')
    writeFileSync(join(repo, 'a.txt'), 'main\n')
    git(repo, 'commit', '-q', '-am', 'Main')
    expect(() => git(repo, 'merge', '-q', 'side')).toThrow('Command failed: git merge')
    git(repo, 'mv', 'old.txt', 'new.txt')
    const before = status(repo)
    expect(before).toEqual(['UU a.txt', 'R  old.txt -> new.txt'])
    const result = await stashChanges(repo, { paths: ['new.txt'], untracked: [], message: '' })
    expect(result.ok).toBe(false)
    expect(result.output).toContain('needs merge')
    // The rename's old side, put back in the index for the stash, is staged as deleted again.
    expect(status(repo)).toEqual(before)
    expect(await listStashes(repo)).toEqual([])
  })

  it('refuses a message too long to hand to git', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'a changed\n')
    await expect(
      stashChanges(repo, { paths: ['a.txt'], untracked: [], message: 'x'.repeat(16_001) })
    ).rejects.toThrow('A stash message is at most 16,000 characters.')
    const message = 'x'.repeat(16_000)
    expect(await stashChanges(repo, { paths: ['a.txt'], untracked: [], message })).toMatchObject({
      ok: true
    })
    expect((await listStashes(repo))[0]?.message).toBe(message)
  })

  it('stashes the chosen untracked files only, taking names with glob characters literally', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'chosen[1].txt'), 'chosen\n')
    writeFileSync(join(repo, 'chosen1.txt'), 'left on disk\n')
    writeFileSync(join(repo, 'other.txt'), 'left on disk\n')
    const result = await stashChanges(repo, {
      paths: [],
      untracked: ['chosen[1].txt'],
      message: 'new file'
    })
    expect(result.ok).toBe(true)
    expect(existsSync(join(repo, 'chosen[1].txt'))).toBe(false)
    expect(status(repo)).toEqual(['?? chosen1.txt', '?? other.txt'])
    const [entry] = await listStashes(repo)
    expect(await unstash(repo, entry?.id, true)).toMatchObject({ ok: true })
    expect(read(repo, 'chosen[1].txt')).toBe('chosen\n')
  })

  it('refuses nothing to stash, an untracked file among tracked ones and a path outside', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'loose.txt'), 'x\n')
    expect(await stashChanges(repo, { paths: ['a.txt'], untracked: [], message: '' })).toEqual({
      ok: false,
      output: 'None of these files has changes to stash.'
    })
    await expect(
      stashChanges(repo, { paths: ['loose.txt'], untracked: [], message: '' })
    ).rejects.toThrow('loose.txt is untracked')
    await expect(
      stashChanges(repo, { paths: [], untracked: ['a.txt'], message: '' })
    ).rejects.toThrow('a.txt is not an untracked file.')
    await expect(
      stashChanges(repo, { paths: ['../x'], untracked: [], message: '' })
    ).rejects.toThrow('outside the repository')
    expect(await listStashes(repo)).toEqual([])
  })
})

describe('listStashes and unstash', () => {
  it('lists newest first with branch and message, and applies, pops and drops by commit', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'first\n')
    // git keeps whole seconds.
    const before = Math.floor(Date.now() / 1000) * 1000
    await stashChanges(repo, { paths: ['a.txt'], untracked: [], message: 'first' })
    const after = Date.now()
    git(repo, 'switch', '-q', '-c', 'feature')
    writeFileSync(join(repo, 'b.txt'), 'second\n')
    // Without a message git names the stash after the last commit.
    await stashChanges(repo, { paths: ['b.txt'], untracked: [], message: '' })
    const [second, first] = await listStashes(repo)
    expect(second?.branch).toBe('feature')
    expect(second?.message).toMatch(/^[0-9a-f]+ Add the files$/)
    expect(first).toMatchObject({ branch: 'main', detached: false, message: 'first' })
    expect(first?.createdAt).toBeGreaterThanOrEqual(before)
    expect(first?.createdAt).toBeLessThanOrEqual(after)
    expect(await stashToShow(repo, first?.id)).toBe('stash@{1}')

    // Apply keeps it, pop removes it: each found by its commit, whatever its index now.
    expect(await unstash(repo, first?.id, false)).toMatchObject({ ok: true })
    expect(read(repo, 'a.txt')).toBe('first\n')
    expect(await listStashes(repo)).toHaveLength(2)
    git(repo, 'checkout', '--', 'a.txt')
    expect(await unstash(repo, first?.id, true)).toMatchObject({ ok: true })
    expect((await listStashes(repo)).map((entry) => entry.id)).toEqual([second?.id])

    expect(await dropStash(repo, second?.id)).toMatchObject({ ok: true })
    expect(await listStashes(repo)).toEqual([])
    // Gone meanwhile: refused with why, before git runs.
    expect(await unstash(repo, second?.id, true)).toEqual({
      ok: false,
      output: 'That stash is no longer there: it was popped or dropped meanwhile.'
    })
    expect(await dropStash(repo, second?.id)).toMatchObject({ ok: false })
    await expect(unstash(repo, 'stash@{0}', false)).rejects.toThrow('Invalid stash.')
  })

  it('names a detached HEAD as such, and a stash git stored itself without a branch', async () => {
    const repo = makeRepo()
    git(repo, 'switch', '-q', '--detach')
    writeFileSync(join(repo, 'a.txt'), 'detached\n')
    await stashChanges(repo, { paths: ['a.txt'], untracked: [], message: 'on no branch' })
    // What a rebase's autostash leaves when it can't be applied back.
    writeFileSync(join(repo, 'b.txt'), 'autostashed\n')
    const commit = git(repo, 'stash', 'create')
    git(repo, 'checkout', '--', 'b.txt')
    git(repo, 'stash', 'store', '--message', 'autostash', commit)
    const [stored, detached] = await listStashes(repo)
    expect(stored).toMatchObject({
      id: commit,
      branch: null,
      detached: false,
      message: 'autostash'
    })
    expect(detached).toMatchObject({ branch: null, detached: true, message: 'on no branch' })
  })

  it('a conflicting pop shows git’s output, leaves the conflict and keeps the stash', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'a.txt'), 'stashed\n')
    await stashChanges(repo, { paths: ['a.txt'], untracked: [], message: 'mine' })
    writeFileSync(join(repo, 'a.txt'), 'committed meanwhile\n')
    git(repo, 'commit', '-q', '-am', 'Change a')
    const [entry] = await listStashes(repo)
    const result = await unstash(repo, entry?.id, true)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('CONFLICT')
    expect(status(repo)).toEqual(['UU a.txt'])
    expect((await listStashes(repo)).map((each) => each.id)).toEqual([entry?.id])
  })
})
