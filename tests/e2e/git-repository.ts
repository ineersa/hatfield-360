import { execFileSync } from 'node:child_process'
import { realpath } from 'node:fs/promises'
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
