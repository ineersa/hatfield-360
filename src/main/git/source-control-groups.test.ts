import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { commitChanges } from './source-control'
import { sourceControlStatus, workingTreeOf } from './source-control-groups'
import { WorktreeStore } from './worktree-store'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'hatfield-source-control-groups-')))
const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM }

// Git runs with the process environment: a config of our own, never the user's identity or hooks.
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

it("names a symlinked project's files by its workspace folder and linked worktrees by git's path", async () => {
  const repo = join(root, 'real', 'app')
  git(root, 'init', '-q', repo)
  writeFileSync(join(repo, 'a.ts'), 'a\n')
  git(repo, 'add', 'a.ts')
  git(repo, 'commit', '-q', '-m', 'first')
  const feature = join(root, 'real', 'app-feature')
  git(repo, 'worktree', 'add', '-q', '-b', 'feature', feature)
  const link = join(root, 'app-link')
  symlinkSync(repo, link)
  writeFileSync(join(repo, 'a.ts'), 'changed\n')
  writeFileSync(join(feature, 'a.ts'), 'feature\n')
  const store = new WorktreeStore()
  await store.setFolders([{ path: link, multiRepo: false }])
  try {
    const groups = await sourceControlStatus(store.view())

    expect(
      groups.map((group) => ({
        root: group.root,
        name: group.name,
        worktree: group.worktree,
        parent: group.parent,
        files: group.status === 'git' ? group.files.map((file) => file.absolutePath) : []
      }))
    ).toEqual([
      { root: link, name: 'app-link', worktree: false, parent: null, files: [join(link, 'a.ts')] },
      {
        root: feature,
        name: 'app-feature',
        worktree: true,
        parent: link,
        files: [join(feature, 'a.ts')]
      }
    ])
    const place = workingTreeOf(store.view(), link)
    expect(
      (await commitChanges(place.root, { paths: ['a.ts'], message: 'Linked', amend: false })).ok
    ).toBe(true)
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('Linked\n')
  } finally {
    await store.setFolders([])
  }
})

it('gives each repository inside a multi-repo folder its own groups, and lists one that is also a project once', async () => {
  const apps = join(root, 'apps')
  for (const name of ['web', 'api', 'lib']) {
    const repo = join(apps, name)
    git(root, 'init', '-q', repo)
    git(repo, 'commit', '-q', '--allow-empty', '-m', `${name} first`)
  }
  mkdirSync(join(apps, 'docs'))
  const feature = join(root, 'api-feature')
  git(join(apps, 'api'), 'worktree', 'add', '-q', '-b', 'feature', feature)
  writeFileSync(join(apps, 'web', 'w.txt'), 'w\n')
  git(join(apps, 'web'), 'add', 'w.txt')
  git(join(apps, 'web'), 'commit', '-q', '-m', 'Add w')
  writeFileSync(join(apps, 'web', 'w.txt'), 'w two\n')
  const store = new WorktreeStore()
  try {
    // Unmarked, the folder is one project git can't read.
    await store.setFolders([{ path: apps, multiRepo: false }])
    expect((await sourceControlStatus(store.view())).map((group) => group.status)).toEqual([
      'not-git'
    ])

    // lib is also a workspace project, so it is listed there and not inside apps.
    await store.setFolders([
      { path: apps, multiRepo: true },
      { path: join(apps, 'lib'), multiRepo: false }
    ])
    const groups = await sourceControlStatus(store.view())
    expect(
      groups.map(({ project, root: tree, name, parent }) => ({ project, root: tree, name, parent }))
    ).toEqual([
      { project: apps, root: join(apps, 'api'), name: 'apps/api', parent: null },
      { project: apps, root: feature, name: 'api-feature', parent: join(apps, 'api') },
      { project: apps, root: join(apps, 'web'), name: 'apps/web', parent: null },
      { project: join(apps, 'lib'), root: join(apps, 'lib'), name: 'lib', parent: null }
    ])

    // A git action on a repository inside the folder runs in that repository only.
    const web = workingTreeOf(store.view(), join(apps, 'web'))
    expect(web.repository).toBe(join(apps, 'web'))
    expect(
      (await commitChanges(web.root, { paths: ['w.txt'], message: 'Change w', amend: false })).ok
    ).toBe(true)
    expect(git(join(apps, 'web'), 'log', '-1', '--format=%s')).toBe('Change w\n')
    expect(git(join(apps, 'api'), 'log', '-1', '--format=%s')).toBe('api first\n')

    // Unmarked again, the repositories inside are no longer followed.
    await store.setFolders([{ path: apps, multiRepo: false }])
    expect(store.view()).toEqual([{ folder: apps, status: 'not-git' }])
  } finally {
    await store.setFolders([])
  }
})
