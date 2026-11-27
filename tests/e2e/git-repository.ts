import type { Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeTempDir } from './launch-app'

export function git(cwd: string, ...args: string[]): void {
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

/** A repository `app` with one commit on `main`, in a fresh folder (resolved, as git prints it). */
export async function makeRepo(): Promise<{
  projects: string
  repo: string
  cleanup: () => Promise<void>
}> {
  const [dir, cleanup] = await makeTempDir('projects')
  const projects = await realpath(dir)
  const repo = join(projects, 'app')
  git(projects, 'init', '-q', '-b', 'main', repo)
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'first')
  return { projects, repo, cleanup }
}

/** git's own output, for checking what the app committed. */
export const gitOutput = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/**
 * The repository `app` with a.txt, b.txt and c.txt committed and pushed to a bare `remote.git`,
 * a workspace holding it, and a git config of its own for the commits the app makes.
 */
export async function commitFixture(): Promise<{
  repo: string
  remote: string
  userData: string
  env: Record<string, string>
  cleanup: () => Promise<void>
}> {
  const { projects, repo, cleanup } = await makeRepo()
  const remote = join(projects, 'remote.git')
  git(projects, 'init', '-q', '--bare', '-b', 'main', remote)
  for (const name of ['a.txt', 'b.txt', 'c.txt']) await writeFile(join(repo, name), `${name} one\n`)
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'Add files')
  git(repo, 'remote', 'add', 'origin', remote)
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  // The app keeps agent logs and state in the project's .hatfield folder; they are not the test's changes.
  await mkdir(join(repo, '.git', 'info'), { recursive: true })
  await writeFile(join(repo, '.git', 'info', 'exclude'), '.hatfield/\n')
  const userData = join(projects, 'user-data')
  await mkdir(join(userData, 'workspaces'), { recursive: true })
  await writeFile(
    join(userData, 'workspaces', 'default.hatfield-workspace'),
    JSON.stringify({ version: 1, folders: [{ path: repo, kind: 'project' }] })
  )
  // The DOM renderer, so terminal text can be read.
  await writeFile(join(userData, 'settings.json'), '{ "terminal.gpuAcceleration": false }')
  // Main passes its environment to git and hooks: commits stay off the user's config and keys.
  const gitConfig = join(projects, 'gitconfig')
  await writeFile(
    gitConfig,
    '[user]\n\tname = Tester\n\temail = tester@example.com\n[commit]\n\tgpgsign = false\n[pull]\n\trebase = false\n'
  )
  return {
    repo,
    remote,
    userData,
    env: { GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' },
    cleanup
  }
}

export const showGit = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('button', { name: 'Git', exact: true })
    .click()

/** The Git view's Commit panel tree. */
export const changes = (page: Page) => page.getByRole('tree', { name: 'Changes' })
export const row = (page: Page, name: string) =>
  changes(page).getByRole('treeitem', { name, exact: true })
