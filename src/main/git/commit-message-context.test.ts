import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  commitMessageContext,
  commitMessagePrompt,
  contextFileDiff,
  replyMessage
} from './commit-message-context'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'hatfield-commit-message-')))
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
  process.env.GIT_CONFIG_GLOBAL = saved.global
  process.env.GIT_CONFIG_NOSYSTEM = saved.system
  rmSync(root, { recursive: true, force: true })
})

const git = (repo: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()

let count = 0
/** A repository with two commits: `keep.txt`, `old.txt` and `image.bin`, then a second subject. */
function makeRepo(): string {
  const repo = join(root, `repo-${count++}`)
  git(root, 'init', '-q', repo)
  writeFileSync(join(repo, 'keep.txt'), 'one\ntwo\n')
  writeFileSync(join(repo, 'old.txt'), 'moved\n')
  writeFileSync(join(repo, 'gone.txt'), 'bye\n')
  writeFileSync(join(repo, 'image.bin'), Buffer.from([0, 1, 2, 3]))
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'Add the files')
  writeFileSync(join(repo, 'keep.txt'), 'one\ntwo\nthree\n')
  git(repo, 'commit', '-q', '-am', 'Add line three')
  return repo
}

describe('commitMessageContext', () => {
  it('names and counts exactly the checked changes, modified, added, deleted, renamed and binary', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'keep.txt'), 'one\n2\nthree\nfour\n')
    writeFileSync(join(repo, 'new.txt'), 'a\nb\n')
    git(repo, 'add', 'new.txt')
    git(repo, 'mv', 'old.txt', 'moved.txt')
    git(repo, 'rm', '-q', 'gone.txt')
    writeFileSync(join(repo, 'image.bin'), Buffer.from([0, 9, 9]))
    writeFileSync(join(repo, 'unchecked.txt'), 'not asked for\n')
    const context = await commitMessageContext(repo, {
      paths: ['keep.txt', 'new.txt', 'moved.txt', 'old.txt', 'gone.txt', 'image.bin'],
      amend: false
    })
    expect(context.branch).toBe('main')
    expect(context.subjects).toEqual(['Add line three', 'Add the files'])
    expect(context.amended).toBeNull()
    expect(context.files.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'gone.txt', from: null, kind: 'deleted', added: 0, deleted: 1 },
      { path: 'image.bin', from: null, kind: 'modified', added: null, deleted: null },
      { path: 'keep.txt', from: null, kind: 'modified', added: 2, deleted: 1 },
      { path: 'moved.txt', from: 'old.txt', kind: 'renamed', added: 0, deleted: 0 },
      { path: 'new.txt', from: null, kind: 'added', added: 2, deleted: 0 }
    ])

    const prompt = commitMessagePrompt(context, 'Use Conventional Commits.')
    expect(prompt).toContain('- modified keep.txt (+2 -1)')
    expect(prompt).toContain('- renamed old.txt → moved.txt (+0 -0)')
    expect(prompt).toContain('- modified image.bin (binary)')
    expect(prompt).toContain('- Add line three\n- Add the files')
    expect(prompt).toContain("The user's rules for commit messages:\nUse Conventional Commits.")
    // Names and counts only: no line of any diff.
    expect(prompt).not.toContain('four')
    expect(prompt).not.toContain('unchecked.txt')
  })

  it('with Amend, adds the last commit, its message and its own changes', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'new.txt'), 'a\n')
    git(repo, 'add', 'new.txt')
    const context = await commitMessageContext(repo, { paths: ['new.txt'], amend: true })
    expect(context.amended).toEqual({
      message: 'Add line three',
      files: [{ path: 'keep.txt', from: null, kind: 'modified', added: 1, deleted: 0 }]
    })
    expect(context.files).toEqual([
      { path: 'new.txt', from: null, kind: 'added', added: 1, deleted: 0 }
    ])
    const prompt = commitMessagePrompt(context, '')
    expect(prompt).toContain('This replaces the last commit (amend). Its message:\nAdd line three')
    expect(prompt).toContain('Changes added to it now:\n- added new.txt (+1 -0)')
    expect(prompt).not.toContain("The user's rules")
  })

  it('reads a repository before its first commit', async () => {
    const repo = join(root, `repo-${count++}`)
    git(root, 'init', '-q', repo)
    writeFileSync(join(repo, 'first.txt'), 'hello\n')
    git(repo, 'add', 'first.txt')
    const context = await commitMessageContext(repo, { paths: ['first.txt'], amend: false })
    expect(context).toEqual({
      branch: 'main',
      subjects: [],
      amended: null,
      files: [{ path: 'first.txt', from: null, kind: 'added', added: 1, deleted: 0 }]
    })
    expect(commitMessagePrompt(context, '')).toContain('The repository has no commits yet.')
  })

  it('with Amend on a merge, gives what the merge brought in against its first parent', async () => {
    const repo = makeRepo()
    git(repo, 'switch', '-q', '-c', 'feature')
    writeFileSync(join(repo, 'feature.txt'), 'f\n')
    git(repo, 'add', 'feature.txt')
    git(repo, 'commit', '-q', '-m', 'Add the feature')
    git(repo, 'switch', '-q', 'main')
    writeFileSync(join(repo, 'main.txt'), 'm\n')
    git(repo, 'add', 'main.txt')
    git(repo, 'commit', '-q', '-m', 'Add main work')
    git(repo, 'merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature')
    const context = await commitMessageContext(repo, { paths: [], amend: true })
    expect(context.amended).toEqual({
      message: 'Merge feature',
      files: [{ path: 'feature.txt', from: null, kind: 'added', added: 1, deleted: 0 }]
    })
    expect(await contextFileDiff(repo, context, 'feature.txt')).toContain('+f')
  })

  it('with Amend before the first commit, has no commit to replace', async () => {
    const repo = join(root, `repo-${count++}`)
    git(root, 'init', '-q', repo)
    writeFileSync(join(repo, 'first.txt'), 'hello\n')
    git(repo, 'add', 'first.txt')
    const context = await commitMessageContext(repo, { paths: ['first.txt'], amend: true })
    expect(context.amended).toBeNull()
    expect(context.files).toEqual([
      { path: 'first.txt', from: null, kind: 'added', added: 1, deleted: 0 }
    ])
  })

  it('counts the lines of a file whose name holds a tab', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'a\tb.txt'), 'one\ntwo\n')
    git(repo, 'add', 'a\tb.txt')
    const context = await commitMessageContext(repo, { paths: ['a\tb.txt'], amend: false })
    expect(context.files).toEqual([
      { path: 'a\tb.txt', from: null, kind: 'added', added: 2, deleted: 0 }
    ])
  })

  it('refuses a path outside the repository', async () => {
    const repo = makeRepo()
    await expect(commitMessageContext(repo, { paths: ['../x'], amend: false })).rejects.toThrow(
      'outside the repository'
    )
  })
})

describe('contextFileDiff', () => {
  it("gives a checked file's diff, the amended commit's too, and refuses any other file", async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'keep.txt'), 'one\ntwo\nthree\nfour\n')
    writeFileSync(join(repo, 'gone.txt'), 'changed but not checked\n')
    const context = await commitMessageContext(repo, { paths: ['keep.txt'], amend: true })
    const diff = await contextFileDiff(repo, context, 'keep.txt')
    // The amended commit's own change, then the checked one.
    expect(diff).toMatch(/\+three[\s\S]*\+four/)
    await expect(contextFileDiff(repo, context, 'gone.txt')).rejects.toThrow(
      "gone.txt isn't one of the changes to commit."
    )
  })

  it('cuts a long diff and says how much is left out', async () => {
    const repo = makeRepo()
    writeFileSync(join(repo, 'keep.txt'), `${'x'.repeat(100)}\n`.repeat(400))
    const context = await commitMessageContext(repo, { paths: ['keep.txt'], amend: false })
    const diff = await contextFileDiff(repo, context, 'keep.txt')
    expect(diff).toMatch(/\n\[The diff is cut here: \d+ more characters\.\]$/)
    expect(diff.length).toBeLessThan(17_000)
  })
})

describe('replyMessage', () => {
  it('takes the message out of a fence or quotes and trims its lines', () => {
    expect(replyMessage('```text\nFix the parser  \n\n\n\nIt failed on tabs.\n```')).toBe(
      'Fix the parser\n\nIt failed on tabs.'
    )
    expect(replyMessage('"Add tests"')).toBe('Add tests')
    // Quotes that belong to the message stay.
    expect(replyMessage('"Hello" -> "Welcome back"')).toBe('"Hello" -> "Welcome back"')
    expect(replyMessage("'foo' and 'bar'")).toBe("'foo' and 'bar'")
    expect(replyMessage('  Add tests\n')).toBe('Add tests')
  })
})
