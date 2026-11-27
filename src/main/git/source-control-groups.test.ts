import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
  await store.setFolders([link])
  try {
    const groups = await sourceControlStatus(store.view())

    expect(
      groups.map((group) => ({
        root: group.root,
        name: group.name,
        worktree: group.worktree,
        files: group.status === 'git' ? group.files.map((file) => file.absolutePath) : []
      }))
    ).toEqual([
      { root: link, name: 'app-link', worktree: false, files: [join(link, 'a.ts')] },
      { root: feature, name: 'app-feature', worktree: true, files: [join(feature, 'a.ts')] }
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
