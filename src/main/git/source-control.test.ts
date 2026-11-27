import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addUntrackedFiles,
  commitChanges,
  diffBase,
  fetchRemote,
  ignoreUntrackedFile,
  lastCommitMessage,
  leftoverIndexLock,
  MAX_PATHS,
  pullBranch,
  pushBranch,
  readWorkingTreeStatus,
  rollbackChanges
} from './source-control'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'hatfield-source-control-')))
const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM }
/** Editors the environment may name (agents set GIT_EDITOR=true): the app must not rely on them. */
const EDITOR_VARIABLES = ['GIT_EDITOR', 'GIT_SEQUENCE_EDITOR', 'VISUAL', 'EDITOR'] as const
const savedEditors = EDITOR_VARIABLES.map((name) => [name, process.env[name]] as const)

// The module runs git with the process environment: point it at a config of our own, never the user's
// identity, signing or hooks path.
beforeAll(() => {
  const config = join(root, 'gitconfig')
  writeFileSync(
    config,
    '[user]\n\tname = Test\n\temail = test@example.com\n[commit]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n[pull]\n\trebase = false\n'
  )
  process.env.GIT_CONFIG_GLOBAL = config
  process.env.GIT_CONFIG_NOSYSTEM = '1'
  for (const name of EDITOR_VARIABLES) delete process.env[name]
})

afterAll(() => {
  if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL
  else process.env.GIT_CONFIG_GLOBAL = saved.global
  if (saved.system === undefined) delete process.env.GIT_CONFIG_NOSYSTEM
  else process.env.GIT_CONFIG_NOSYSTEM = saved.system
  for (const [name, value] of savedEditors) if (value !== undefined) process.env[name] = value
  rmSync(root, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
}

const write = (repo: string, path: string, text: string): void => {
  mkdirSync(join(repo, path, '..'), { recursive: true })
  writeFileSync(join(repo, path), text)
}

const read = (repo: string, path: string): string => readFileSync(join(repo, path), 'utf8')

/** A repository with one commit holding each named file (its content is its name). */
function makeRepo(name: string, files: string[]): string {
  const repo = join(root, name)
  git(root, 'init', '-q', repo)
  for (const file of files) write(repo, file, `${file}\n`)
  git(repo, 'add', '--all')
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'first')
  return repo
}

const commitCount = (repo: string): string => git(repo, 'rev-list', '--count', 'HEAD').trim()

/** HEAD's parents, one per merged branch. */
const parentCount = (repo: string): number =>
  git(repo, 'rev-list', '--parents', '-n', '1', 'HEAD').trim().split(' ').length - 1

/** A clone of `repo` through a new bare remote, which it is tracking. */
function cloneThroughRemote(repo: string, name: string): string {
  const remote = join(root, `${name}.git`)
  git(root, 'init', '-q', '--bare', remote)
  git(repo, 'remote', 'add', 'origin', remote)
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  const clone = join(root, `${name}-clone`)
  git(root, 'clone', '-q', remote, clone)
  return clone
}

/** `kind path` for each changed file, sorted. */
async function changes(repo: string): Promise<string[]> {
  const { files } = await readWorkingTreeStatus(repo)
  return files.map((file) => `${file.kind} ${file.path}`).toSorted()
}

describe('readWorkingTreeStatus', () => {
  it('lists every kind of change, untracked files one by one', async () => {
    const repo = makeRepo('status', ['modified.ts', 'deleted.ts', 'old.ts'])
    write(repo, 'modified.ts', 'changed\n')
    rmSync(join(repo, 'deleted.ts'))
    git(repo, 'mv', 'old.ts', 'new.ts')
    write(repo, 'added.ts', 'added\n')
    git(repo, 'add', 'added.ts')
    write(repo, 'folder/inner/one.ts', '1\n')
    write(repo, 'folder/two.ts', '2\n')

    const status = await readWorkingTreeStatus(repo)

    expect(status).toMatchObject({ branch: 'main', upstream: null, ahead: null, behind: null })
    expect(status.files.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
      {
        path: 'added.ts',
        absolutePath: join(repo, 'added.ts'),
        originalPath: null,
        kind: 'added',
        nestedRepository: false
      },
      {
        path: 'deleted.ts',
        absolutePath: join(repo, 'deleted.ts'),
        originalPath: null,
        kind: 'deleted',
        nestedRepository: false
      },
      {
        path: 'folder/inner/one.ts',
        absolutePath: join(repo, 'folder', 'inner', 'one.ts'),
        originalPath: null,
        kind: 'untracked',
        nestedRepository: false
      },
      {
        path: 'folder/two.ts',
        absolutePath: join(repo, 'folder', 'two.ts'),
        originalPath: null,
        kind: 'untracked',
        nestedRepository: false
      },
      {
        path: 'modified.ts',
        absolutePath: join(repo, 'modified.ts'),
        originalPath: null,
        kind: 'modified',
        nestedRepository: false
      },
      {
        path: 'new.ts',
        absolutePath: join(repo, 'new.ts'),
        originalPath: 'old.ts',
        kind: 'renamed',
        nestedRepository: false
      }
    ])
  })

  it('marks a merge conflict and reports a detached HEAD without a branch', async () => {
    const repo = makeRepo('conflict', ['shared.ts'])
    git(repo, 'checkout', '-q', '-b', 'other')
    write(repo, 'shared.ts', 'other\n')
    git(repo, 'commit', '-q', '-am', 'other')
    git(repo, 'checkout', '-q', 'main')
    write(repo, 'shared.ts', 'main\n')
    git(repo, 'commit', '-q', '-am', 'main')
    expect(() => git(repo, 'merge', '-q', 'other')).toThrow('Command failed')

    expect(await changes(repo)).toEqual(['conflicted shared.ts'])

    git(repo, 'merge', '--abort')
    git(repo, 'checkout', '-q', '--detach', 'HEAD')
    expect((await readWorkingTreeStatus(repo)).branch).toBeNull()
  })
})

describe('commitChanges', () => {
  it('commits the checked files as they are on disk and leaves every other change in place', async () => {
    const repo = makeRepo('partial', ['checked.ts', 'unchecked.ts'])
    write(repo, 'checked.ts', 'staged\n')
    git(repo, 'add', 'checked.ts')
    write(repo, 'checked.ts', 'staged\non disk\n')
    write(repo, 'unchecked.ts', 'not committed\n')
    write(repo, 'staged.ts', 'staged only\n')
    git(repo, 'add', 'staged.ts')
    write(repo, 'new.ts', 'new\n')
    expect((await addUntrackedFiles(repo, ['new.ts'])).ok).toBe(true)

    const result = await commitChanges(repo, {
      paths: ['checked.ts', 'new.ts'],
      message: 'Commit two files',
      amend: false
    })

    expect(result.ok).toBe(true)
    expect(git(repo, 'show', '-s', '--format=%s', 'HEAD')).toBe('Commit two files\n')
    expect(git(repo, 'show', 'HEAD:checked.ts')).toBe('staged\non disk\n')
    expect(git(repo, 'show', 'HEAD:new.ts')).toBe('new\n')
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('staged.ts\n')
    expect(await changes(repo)).toEqual(['added staged.ts', 'modified unchecked.ts'])
  })

  it('takes glob-like names literally and commits both sides of a rename and a deletion', async () => {
    const repo = makeRepo('literal', ['old.ts', 'a.txt', 'gone.ts'])
    git(repo, 'mv', 'old.ts', 'renamed.ts')
    write(repo, '*.txt', 'star\n')
    write(repo, '[a].ts', 'brackets\n')
    write(repo, 'a.txt', 'matches the glob but is not checked\n')
    rmSync(join(repo, 'gone.ts'))
    expect((await addUntrackedFiles(repo, ['*.txt', '[a].ts'])).ok).toBe(true)

    const result = await commitChanges(repo, {
      paths: ['renamed.ts', '*.txt', '[a].ts', 'gone.ts'],
      message: 'Literal paths',
      amend: false
    })

    expect(result.ok).toBe(true)
    expect(
      git(repo, 'show', '--format=', '--name-status', '-M', 'HEAD').split('\n').toSorted()
    ).toEqual(['', 'A\t*.txt', 'A\t[a].ts', 'D\tgone.ts', 'R100\told.ts\trenamed.ts'])
    expect(await changes(repo)).toEqual(['modified a.txt'])
    // `*.txt` as a glob would also have staged a.txt.
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('')
  })

  it('amends: with no files only the message changes, with files they join the last commit', async () => {
    const repo = makeRepo('amend', ['file.ts'])
    write(repo, 'staged.ts', 'staged\n')
    git(repo, 'add', 'staged.ts')

    const reworded = await commitChanges(repo, {
      paths: [],
      message: 'Better words\n\nWith a body',
      amend: true
    })

    expect(reworded.ok).toBe(true)
    expect(commitCount(repo)).toBe('1')
    expect(await lastCommitMessage(repo)).toBe('Better words\n\nWith a body')
    expect(git(repo, 'show', '--format=', '--name-only', 'HEAD')).toBe('file.ts\n')

    write(repo, 'file.ts', 'changed\n')
    const amended = await commitChanges(repo, { paths: ['file.ts'], message: 'Again', amend: true })

    expect(amended.ok).toBe(true)
    expect(commitCount(repo)).toBe('1')
    expect(git(repo, 'show', 'HEAD:file.ts')).toBe('changed\n')
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('staged.ts\n')
  })

  it('returns a failing pre-commit hook output verbatim and commits nothing', async () => {
    const repo = makeRepo('hook', ['file.ts'])
    const hook = join(repo, '.git', 'hooks', 'pre-commit')
    writeFileSync(hook, '#!/bin/sh\necho "lint: 2 problems"\necho "file.ts:1 bad" >&2\nexit 1\n')
    chmodSync(hook, 0o755)
    const head = git(repo, 'rev-parse', 'HEAD')
    write(repo, 'file.ts', 'changed\n')
    write(repo, 'new.ts', 'new\n')

    const result = await commitChanges(repo, {
      paths: ['file.ts'],
      message: 'Blocked',
      amend: false
    })

    expect(result).toEqual({ ok: false, output: 'lint: 2 problems\nfile.ts:1 bad\n' })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
    expect(await changes(repo)).toEqual(['modified file.ts', 'untracked new.ts'])
  })

  it('refuses an untracked file, amending or not, leaving the repository untouched', async () => {
    const repo = makeRepo('untracked', ['file.ts'])
    write(repo, 'file.ts', 'changed\n')
    write(repo, 'new.ts', 'new\n')
    const head = git(repo, 'rev-parse', 'HEAD')

    for (const amend of [false, true])
      expect(
        await commitChanges(repo, { paths: ['file.ts', 'new.ts'], message: 'Sneak in', amend })
      ).toEqual({ ok: false, output: 'Add new.ts to version control first.' })

    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('')
    expect(await changes(repo)).toEqual(['modified file.ts', 'untracked new.ts'])
  })

  it('refuses a path outside the repository before running git', async () => {
    const repo = makeRepo('outside', ['file.ts'])
    write(root, 'outside.ts', 'outside\n')
    write(repo, 'file.ts', 'changed\n')
    const request = { message: 'Escape', amend: false }

    await expect(commitChanges(repo, { ...request, paths: ['../outside.ts'] })).rejects.toThrow(
      '../outside.ts is outside the repository.'
    )
    await expect(
      commitChanges(repo, { ...request, paths: [join(root, 'outside.ts')] })
    ).rejects.toThrow('Invalid file path.')
    expect(commitCount(repo)).toBe('1')
  })

  it('refuses an empty message without running git', async () => {
    const repo = makeRepo('empty-message', ['file.ts'])
    write(repo, 'file.ts', 'changed\n')
    expect(
      await commitChanges(repo, { paths: ['file.ts'], message: '  \n', amend: false })
    ).toEqual({ ok: false, output: 'Write a commit message.' })
    expect(commitCount(repo)).toBe('1')
  })
})

/**
 * A repository whose Pull stopped on a conflict in shared.ts with what another clone pushed;
 * other.ts merged cleanly and kept.ts has a change of its own.
 */
async function conflictingPull(name: string): Promise<string> {
  const repo = makeRepo(name, ['shared.ts', 'other.ts', 'kept.ts'])
  const clone = cloneThroughRemote(repo, name)
  write(clone, 'shared.ts', 'theirs\n')
  write(clone, 'other.ts', 'merged in\n')
  git(clone, 'commit', '-q', '-am', 'Theirs')
  git(clone, 'push', '-q')
  write(repo, 'shared.ts', 'ours\n')
  git(repo, 'commit', '-q', '-am', 'Ours')
  write(repo, 'kept.ts', 'not part of the merge\n')
  expect((await pullBranch(repo)).ok).toBe(false)
  return repo
}

describe('commitChanges during a merge, cherry-pick or rebase', () => {
  it('concludes a merge Pull stopped on: the checked paths are staged and the merge committed', async () => {
    const repo = await conflictingPull('merge')
    expect((await readWorkingTreeStatus(repo)).operation).toBe('merge')
    expect(await changes(repo)).toEqual([
      'conflicted shared.ts',
      'modified kept.ts',
      'modified other.ts'
    ])
    write(repo, 'shared.ts', 'resolved\n')

    const result = await commitChanges(repo, {
      paths: ['shared.ts'],
      message: 'Merge theirs',
      amend: false
    })

    expect(result.ok).toBe(true)
    expect(parentCount(repo)).toBe(2)
    expect(git(repo, 'show', '-s', '--format=%s', 'HEAD')).toBe('Merge theirs\n')
    expect(git(repo, 'show', 'HEAD:shared.ts')).toBe('resolved\n')
    expect(git(repo, 'show', 'HEAD:other.ts')).toBe('merged in\n')
    expect(await readWorkingTreeStatus(repo)).toMatchObject({ operation: null })
    expect(await changes(repo)).toEqual(['modified kept.ts'])
  })

  it("refuses while a conflict is unresolved, with git's words or the markers left, committing nothing", async () => {
    const repo = await conflictingPull('merge-unresolved')
    const head = git(repo, 'rev-parse', 'HEAD')

    const unmerged = await commitChanges(repo, {
      paths: ['kept.ts'],
      message: 'Too early',
      amend: false
    })
    const markers = await commitChanges(repo, {
      paths: ['shared.ts'],
      message: 'Still conflicted',
      amend: false
    })

    expect(unmerged.ok).toBe(false)
    expect(unmerged.output).toContain('Committing is not possible because you have unmerged files.')
    expect(markers).toEqual({
      ok: false,
      output: 'shared.ts still has conflict markers: resolve them first.'
    })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
    expect((await readWorkingTreeStatus(repo)).operation).toBe('merge')
  })

  it('concludes a cherry-pick in a linked worktree, whose markers live in its own git dir', async () => {
    const repo = makeRepo('cherry-pick', ['shared.ts'])
    git(repo, 'checkout', '-q', '-b', 'picked')
    write(repo, 'shared.ts', 'picked\n')
    git(repo, 'commit', '-q', '-am', 'To pick')
    git(repo, 'checkout', '-q', 'main')
    const tree = join(root, 'cherry-pick-tree')
    git(repo, 'worktree', 'add', '-q', '-b', 'target', tree)
    write(tree, 'shared.ts', 'target\n')
    git(tree, 'commit', '-q', '-am', 'Target')
    expect(() => git(tree, 'cherry-pick', 'picked')).toThrow('Command failed')
    expect((await readWorkingTreeStatus(tree)).operation).toBe('cherry-pick')
    expect((await readWorkingTreeStatus(repo)).operation).toBeNull()
    write(tree, 'shared.ts', 'both\n')

    const result = await commitChanges(tree, {
      paths: ['shared.ts'],
      message: 'Picked',
      amend: false
    })

    expect(result.ok).toBe(true)
    expect(git(tree, 'log', '--format=%s')).toBe('Picked\nTarget\nfirst\n')
    expect((await readWorkingTreeStatus(tree)).operation).toBeNull()
  })

  it('reports a rebase stopped on a conflict and leaves concluding it to a terminal', async () => {
    const repo = makeRepo('rebase', ['shared.ts', 'other.ts'])
    git(repo, 'checkout', '-q', '-b', 'topic')
    write(repo, 'shared.ts', 'topic\n')
    git(repo, 'commit', '-q', '-am', 'Topic')
    git(repo, 'checkout', '-q', 'main')
    write(repo, 'shared.ts', 'main\n')
    git(repo, 'commit', '-q', '-am', 'Main')
    git(repo, 'checkout', '-q', 'topic')
    expect(() => git(repo, 'rebase', 'main')).toThrow('Command failed')
    write(repo, 'other.ts', 'changed\n')
    const head = git(repo, 'rev-parse', 'HEAD')

    expect((await readWorkingTreeStatus(repo)).operation).toBe('rebase')
    expect(
      await commitChanges(repo, { paths: ['other.ts'], message: 'Mid-rebase', amend: false })
    ).toEqual({
      ok: false,
      output:
        'A rebase is in progress: continue it (git rebase --continue) or abort it (git rebase --abort) in a terminal.'
    })
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
  })
})

describe('many files at once', () => {
  it('adds, commits and rolls back files whose paths together are longer than a command line takes', async () => {
    const repo = makeRepo('many', [])
    // About 2.3 MB of pathspecs, past Linux's 2 MB and macOS's 1 MB argument limits.
    const deep = Array.from({ length: 15 }, () => 'd'.repeat(250)).join('/')
    const paths = Array.from({ length: 600 }, (_, index) => `${deep}/${index}.ts`)
    mkdirSync(join(repo, deep), { recursive: true })
    for (const path of paths) writeFileSync(join(repo, path), 'x\n')

    expect((await addUntrackedFiles(repo, paths)).ok).toBe(true)
    expect((await commitChanges(repo, { paths, message: 'Many', amend: false })).ok).toBe(true)
    expect(git(repo, 'show', '--shortstat', '--format=', 'HEAD')).toBe(
      ' 600 files changed, 600 insertions(+)\n'
    )
    rmSync(join(repo, 'd'.repeat(250)), { recursive: true })
    expect((await rollbackChanges(repo, paths)).ok).toBe(true)
    expect(await changes(repo)).toEqual([])
  })

  it('takes more paths than the old 5000 and refuses more than one action takes, saying what to do', async () => {
    const repo = makeRepo('too-many', [])
    write(repo, 'a.ts', 'a\n')

    // The same file named over and over costs git nothing to match.
    expect(
      (
        await addUntrackedFiles(
          repo,
          Array.from({ length: 6000 }, () => 'a.ts')
        )
      ).ok
    ).toBe(true)
    await expect(
      rollbackChanges(
        repo,
        Array.from({ length: MAX_PATHS + 1 }, () => 'a.ts')
      )
    ).rejects.toThrow(
      '100,001 files are more than one action takes (100,000). Choose fewer files, or ignore generated folders in .gitignore.'
    )
    expect(await changes(repo)).toEqual(['added a.ts'])
  })
})

describe('git started for the panel', () => {
  // Git starts in a session of its own: a hook could otherwise read the terminal the app started from.
  it('has no terminal to prompt on: a hook opening /dev/tty fails instead of waiting', async () => {
    const repo = makeRepo('no-terminal', ['file.ts'])
    const hook = join(repo, '.git', 'hooks', 'pre-commit')
    writeFileSync(
      hook,
      '#!/bin/sh\nif (: < /dev/tty) 2>/dev/null; then echo terminal; else echo "no terminal"; fi\nexit 1\n'
    )
    chmodSync(hook, 0o755)
    write(repo, 'file.ts', 'changed\n')

    expect(
      await commitChanges(repo, { paths: ['file.ts'], message: 'Hooked', amend: false })
    ).toEqual({ ok: false, output: 'no terminal\n' })
  })

  it('cancels a commit blocked in its hook: the hook is stopped, nothing is committed, no lock is left', async () => {
    const repo = makeRepo('cancel', ['file.ts'])
    const started = join(root, 'cancel-started')
    const blocked = join(root, 'cancel-blocked')
    execFileSync('mkfifo', [started, blocked])
    const hook = join(repo, '.git', 'hooks', 'pre-commit')
    // The hook says it started, then holds `blocked` open for reading and waits on it for ever.
    writeFileSync(
      hook,
      `#!/bin/sh\necho started > '${started}'\nexec 3<> '${blocked}'\nread line <&3\n`
    )
    chmodSync(hook, 0o755)
    write(repo, 'file.ts', 'changed\n')
    const controller = new AbortController()

    const committing = commitChanges(
      repo,
      { paths: ['file.ts'], message: 'Never', amend: false },
      controller.signal
    )
    expect(await readFile(started, 'utf8')).toBe('started\n')
    controller.abort()

    // Resolving at all means the hook let go of git's output: it is stopped along with git.
    expect(await committing).toEqual({ ok: false, output: '', cancelled: true })
    expect(() => openSync(blocked, constants.O_WRONLY | constants.O_NONBLOCK)).toThrow('ENXIO')
    expect(commitCount(repo)).toBe('1')
    expect(git(repo, 'status', '--porcelain')).toBe(' M file.ts\n')
    expect(await leftoverIndexLock(repo)).toBeNull()
  })

  it('accepts what git would open an editor for, as an interactive rebase on pull', async () => {
    const repo = makeRepo('no-editor', ['file.ts'])
    const clone = cloneThroughRemote(repo, 'no-editor')
    write(clone, 'theirs.ts', 'theirs\n')
    git(clone, 'add', 'theirs.ts')
    git(clone, 'commit', '-q', '-m', 'Theirs')
    git(clone, 'push', '-q')
    write(repo, 'ours.ts', 'ours\n')
    git(repo, 'add', 'ours.ts')
    git(repo, 'commit', '-q', '-m', 'Ours')
    git(repo, 'config', 'pull.rebase', 'interactive')
    // The editor the user configured fails: nobody could use it from the panel.
    git(repo, 'config', 'core.editor', 'false')

    const pulled = await pullBranch(repo)

    expect(pulled.ok).toBe(true)
    expect(git(repo, 'log', '--format=%s')).toBe('Ours\nTheirs\nfirst\n')
  })
})

describe('nested repositories', () => {
  it('lists a nested repository and a linked worktree inside the tree as folders, which can be ignored, not added', async () => {
    const repo = makeRepo('nested', ['file.ts'])
    git(repo, 'init', '-q', 'vendor/lib')
    git(repo, 'worktree', 'add', '-q', '-b', 'inner', 'inner tree')
    write(repo, 'new.ts', 'new\n')

    const { files } = await readWorkingTreeStatus(repo)

    expect(
      files
        .map((file) => `${file.kind} ${file.path} ${file.absolutePath} ${file.nestedRepository}`)
        .toSorted()
    ).toEqual([
      `untracked inner tree ${join(repo, 'inner tree')} true`,
      `untracked new.ts ${join(repo, 'new.ts')} false`,
      `untracked vendor/lib ${join(repo, 'vendor', 'lib')} true`
    ])
    await expect(addUntrackedFiles(repo, ['new.ts', 'vendor/lib'])).rejects.toThrow(
      'vendor/lib is a nested repository: add it as a submodule in a terminal, or ignore it.'
    )
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('')

    await ignoreUntrackedFile(repo, 'vendor/lib')
    await ignoreUntrackedFile(repo, 'inner tree')

    expect(read(repo, '.gitignore')).toBe('/vendor/lib/\n/inner tree/\n')
    expect(await changes(repo)).toEqual(['untracked .gitignore', 'untracked new.ts'])
  })
})

describe('diffBase', () => {
  it('is HEAD once the branch has a commit', async () => {
    expect(await diffBase(makeRepo('diff-base', ['a.ts']))).toBe('HEAD')
  })

  it('is the empty tree before the first commit', async () => {
    const repo = join(root, 'diff-base-unborn')
    git(root, 'init', '-q', repo)
    write(repo, 'staged.ts', 'staged\n')
    git(repo, 'add', 'staged.ts')

    expect(await diffBase(repo)).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904')
  })
})

describe('lastCommitMessage', () => {
  it('is null on a branch without commits', async () => {
    const repo = join(root, 'unborn')
    git(root, 'init', '-q', repo)
    expect(await lastCommitMessage(repo)).toBeNull()
  })
})

describe('pushBranch and pullBranch', () => {
  it('pushes a branch without an upstream, setting it, and pulls what another clone pushed', async () => {
    const remote = join(root, 'remote.git')
    git(root, 'init', '-q', '--bare', remote)
    const repo = makeRepo('pusher', ['file.ts'])
    git(repo, 'remote', 'add', 'origin', remote)

    const pushed = await pushBranch(repo)

    expect(pushed.ok).toBe(true)
    expect(git(remote, 'rev-parse', 'main')).toBe(git(repo, 'rev-parse', 'HEAD'))
    expect(await readWorkingTreeStatus(repo)).toMatchObject({
      upstream: 'origin/main',
      ahead: 0,
      behind: 0
    })

    const other = join(root, 'other-clone')
    git(root, 'clone', '-q', remote, other)
    write(other, 'from-other.ts', 'other\n')
    git(other, 'add', 'from-other.ts')
    git(other, 'commit', '-q', '-m', 'From the other clone')
    git(other, 'push', '-q')

    const pulled = await pullBranch(repo)

    expect(pulled.ok).toBe(true)
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(git(other, 'rev-parse', 'HEAD'))
    expect(read(repo, 'from-other.ts')).toBe('other\n')
  })

  it("returns git's own words when there is nowhere to push", async () => {
    const repo = makeRepo('no-remote', ['file.ts'])
    const result = await pushBranch(repo)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('fatal: No configured push destination.')
  })
})

describe('rollbackChanges', () => {
  it('restores tracked files to HEAD, deletes untracked ones and leaves the rest', async () => {
    const repo = makeRepo('rollback', ['modified.ts', 'deleted.ts', 'old.ts', 'kept.ts'])
    write(repo, 'modified.ts', 'changed\n')
    git(repo, 'add', 'modified.ts')
    write(repo, 'modified.ts', 'changed again\n')
    rmSync(join(repo, 'deleted.ts'))
    git(repo, 'mv', 'old.ts', 'new.ts')
    write(repo, 'added.ts', 'added\n')
    git(repo, 'add', 'added.ts')
    write(repo, 'kept.ts', 'kept change\n')

    const result = await rollbackChanges(repo, ['modified.ts', 'deleted.ts', 'new.ts', 'added.ts'])

    expect(result.ok).toBe(true)
    expect(await changes(repo)).toEqual(['modified kept.ts'])
    expect(read(repo, 'modified.ts')).toBe('modified.ts\n')
    expect(read(repo, 'deleted.ts')).toBe('deleted.ts\n')
    expect(read(repo, 'old.ts')).toBe('old.ts\n')
    expect(existsSync(join(repo, 'new.ts'))).toBe(false)
    expect(existsSync(join(repo, 'added.ts'))).toBe(false)
  })

  it('refuses an untracked file, which only Delete removes, before changing anything', async () => {
    const repo = makeRepo('rollback-untracked', ['modified.ts'])
    write(repo, 'modified.ts', 'changed\n')
    write(repo, 'new.ts', 'new\n')
    await expect(rollbackChanges(repo, ['modified.ts', 'new.ts'])).rejects.toThrow(
      'new.ts is untracked: nothing to roll back.'
    )
    expect(await changes(repo)).toEqual(['modified modified.ts', 'untracked new.ts'])
  })
})

describe('fetchRemote', () => {
  it('brings in what another clone pushed, so the branch counts it as behind', async () => {
    const remote = join(root, 'fetch-remote.git')
    git(root, 'init', '-q', '--bare', remote)
    const repo = makeRepo('fetch', ['file.ts'])
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    const other = join(root, 'fetch-other')
    git(root, 'clone', '-q', remote, other)
    write(other, 'from-other.ts', 'other\n')
    git(other, 'add', 'from-other.ts')
    git(other, 'commit', '-q', '-m', 'From the other clone')
    git(other, 'push', '-q')
    expect((await readWorkingTreeStatus(repo)).behind).toBe(0)

    expect((await fetchRemote(repo)).ok).toBe(true)

    expect(await readWorkingTreeStatus(repo)).toMatchObject({ ahead: 0, behind: 1 })
    expect(existsSync(join(repo, 'from-other.ts'))).toBe(false)
  })
})

describe('addUntrackedFiles', () => {
  it('adds untracked files, glob-like names literally, and leaves the rest untracked', async () => {
    const repo = makeRepo('add-untracked', [])
    write(repo, 'a[1].ts', 'glob-like\n')
    write(repo, 'a1.ts', 'would match the glob\n')
    write(repo, 'dir/new file.ts', 'spaced\n')

    const result = await addUntrackedFiles(repo, ['a[1].ts', 'dir/new file.ts'])

    expect(result.ok).toBe(true)
    expect(await changes(repo)).toEqual([
      'added a[1].ts',
      'added dir/new file.ts',
      'untracked a1.ts'
    ])
  })

  it('refuses a tracked file or a path outside the repository before running git', async () => {
    const repo = makeRepo('add-refused', ['tracked.ts'])
    write(repo, 'tracked.ts', 'changed\n')
    write(repo, 'new.ts', 'new\n')
    await expect(addUntrackedFiles(repo, ['new.ts', 'tracked.ts'])).rejects.toThrow(
      'tracked.ts is not an untracked file.'
    )
    await expect(addUntrackedFiles(repo, ['../outside.ts'])).rejects.toThrow(
      '../outside.ts is outside the repository.'
    )
    expect(await changes(repo)).toEqual(['modified tracked.ts', 'untracked new.ts'])
  })
})

describe('ignoreUntrackedFile', () => {
  it('ignores exactly the file, whatever glob or comment characters its name holds', async () => {
    const repo = makeRepo('ignore', [])
    const names = ['#notes [draft]?.txt', '!keep*.txt', 'dir/with space.txt']
    for (const name of names) write(repo, name, 'x\n')
    // What each name would match if it were written unescaped.
    for (const name of ['#notes d1.txt', '!keepers.txt', 'other/dir/with space.txt'])
      write(repo, name, 'x\n')

    for (const name of names) await ignoreUntrackedFile(repo, name)

    expect(read(repo, '.gitignore')).toBe(
      '/#notes \\[draft]\\?.txt\n/!keep\\*.txt\n/dir/with space.txt\n'
    )
    expect(await changes(repo)).toEqual([
      'untracked !keepers.txt',
      'untracked #notes d1.txt',
      'untracked .gitignore',
      'untracked other/dir/with space.txt'
    ])
  })

  it('appends to an existing .gitignore, ending it with a newline it lacked', async () => {
    const repo = makeRepo('ignore-append', [])
    write(repo, '.gitignore', 'dist')
    write(repo, 'local.env', 'x\n')
    await ignoreUntrackedFile(repo, 'local.env')
    expect(read(repo, '.gitignore')).toBe('dist\n/local.env\n')
  })

  it('refuses a tracked file and a path outside the repository, writing nothing', async () => {
    const repo = makeRepo('ignore-refused', ['tracked.ts'])
    write(repo, 'tracked.ts', 'changed\n')
    await expect(ignoreUntrackedFile(repo, 'tracked.ts')).rejects.toThrow(
      'tracked.ts is not an untracked file.'
    )
    await expect(ignoreUntrackedFile(repo, '../outside.ts')).rejects.toThrow(
      '../outside.ts is outside the repository.'
    )
    expect(existsSync(join(repo, '.gitignore'))).toBe(false)
  })
})
