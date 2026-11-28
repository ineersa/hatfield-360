import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  gitHubRemote,
  parsePullRequests,
  repositoryReview,
  reviewBase,
  validReviewBase
} from './review'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'hatfield-review-')))
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

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

let count = 0
/** A repository with one commit on `branch`. */
function makeRepo(branch = 'main'): string {
  const repo = join(root, `repo-${count++}`)
  git(root, 'init', '-q', '-b', branch, repo)
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'first')
  return repo
}

describe('reviewBase', () => {
  it('takes the branch origin/HEAD names, as a clone sets it, over origin/main', async () => {
    const upstream = makeRepo('trunk')
    git(upstream, 'branch', 'main')
    const clone = join(root, `clone-${count++}`)
    git(root, 'clone', '-q', upstream, clone)
    git(clone, 'switch', '-q', '-c', 'feature')
    expect(await reviewBase(clone)).toBe('origin/trunk')
  })

  it('falls back to origin/main, then a local main or master, then nothing', async () => {
    const repo = makeRepo()
    const remote = join(root, `remote-${count++}.git`)
    git(root, 'init', '-q', '--bare', remote)
    git(repo, 'remote', 'add', 'origin', remote)
    git(repo, 'push', '-q', '-u', 'origin', 'main')
    // A pushed `git init` has origin/main but no origin/HEAD.
    expect(await reviewBase(repo)).toBe('origin/main')
    expect(await reviewBase(makeRepo())).toBe('main')
    expect(await reviewBase(makeRepo('master'))).toBe('master')
    expect(await reviewBase(makeRepo('trunk'))).toBe(null)
  })
})

describe('validReviewBase', () => {
  it('takes an existing branch and refuses options, unknown names and odd characters', async () => {
    const repo = makeRepo()
    git(repo, 'branch', 'feature/x')
    expect(await validReviewBase(repo, 'feature/x')).toBe('feature/x')
    for (const base of ['--output=x', 'nope', 'main bad', 'main\n', '', 7, null])
      await expect(validReviewBase(repo, base)).rejects.toThrow('Invalid base branch.')
  })
})

describe('repositoryReview', () => {
  it('offers no pull request actions for an origin that is not on GitHub', async () => {
    const repo = makeRepo()
    git(repo, 'remote', 'add', 'origin', 'git@gitlab.com:team/app.git')
    expect(await repositoryReview(repo)).toEqual({ base: 'main', github: null, pullRequest: null })
  })
})

describe('gitHubRemote', () => {
  it('reads the host, owner and repository of GitHub URLs, ssh and https', () => {
    const app = { host: 'github.com', owner: 'team', repo: 'app' }
    expect(gitHubRemote('git@github.com:team/app.git')).toEqual(app)
    expect(gitHubRemote('git@github.com:team/app')).toEqual(app)
    expect(gitHubRemote('https://github.com/team/app.git\n')).toEqual(app)
    expect(gitHubRemote('https://user@github.com/team/app/')).toEqual(app)
    expect(gitHubRemote('ssh://git@github.com:22/team/app.git')).toEqual(app)
    expect(gitHubRemote('ssh://git@GitHub.com/team/my.app.git')).toEqual({
      ...app,
      repo: 'my.app'
    })
    expect(gitHubRemote('https://acme.ghe.com/team/app')).toEqual({ ...app, host: 'acme.ghe.com' })
    // GitHub's SSH over port 443, and an scp-style URL without a user.
    expect(gitHubRemote('ssh://git@ssh.github.com:443/team/app.git')).toEqual(app)
    expect(gitHubRemote('github.com:team/app.git')).toEqual(app)
  })

  it('finds no GitHub repository in other hosts, local paths or partial URLs', () => {
    for (const url of [
      'git@gitlab.com:team/app.git',
      'https://github.com.evil.example/team/app',
      '/srv/git/app.git',
      'file:///srv/git/app.git',
      'https://github.com/team',
      'https://github.com/team/app/pull/1',
      'git@github-work:team/app.git'
    ])
      expect(gitHubRemote(url)).toBe(null)
  })
})

describe('parsePullRequests', () => {
  // Captured from `gh pr list --json number,title,author,headRefName,isDraft,url` (gh 2.103.3).
  const captured =
    '[{"author":{"id":"MDQ6VXNlcjQyMjg4NDM=","is_bot":false,"login":"ineersa","name":"ineersa"},"headRefName":"task/issue-101","isDraft":false,"number":103,"title":"Pin agent sessions (pinned shelf); tab grouping later","url":"https://github.com/ineersa/hatfield-360/pull/103"},{"author":{"id":"MDQ6VXNlcjQyMjg4NDM=","is_bot":false,"login":"ineersa","name":"ineersa"},"headRefName":"task/issue-100","isDraft":true,"number":102,"title":"Agent profiles: wrapper commands, env, ~/ paths, and real catalog errors (#100)","url":"https://github.com/ineersa/hatfield-360/pull/102"}]\n'

  it("reads gh's list", () => {
    expect(parsePullRequests(captured)).toEqual([
      {
        number: 103,
        title: 'Pin agent sessions (pinned shelf); tab grouping later',
        author: 'ineersa',
        branch: 'task/issue-101',
        draft: false,
        url: 'https://github.com/ineersa/hatfield-360/pull/103'
      },
      {
        number: 102,
        title: 'Agent profiles: wrapper commands, env, ~/ paths, and real catalog errors (#100)',
        author: 'ineersa',
        branch: 'task/issue-100',
        draft: true,
        url: 'https://github.com/ineersa/hatfield-360/pull/102'
      }
    ])
    expect(parsePullRequests('[]')).toEqual([])
  })

  it('refuses anything else whole, rather than showing part of it', () => {
    const first = {
      author: { login: 'ineersa' },
      headRefName: 'task/issue-101',
      isDraft: false,
      number: 103,
      title: 'Pin agent sessions',
      url: 'https://github.com/ineersa/hatfield-360/pull/103'
    }
    expect(parsePullRequests(JSON.stringify([first]))).toHaveLength(1)
    const changed = (change: Record<string, unknown>): string =>
      JSON.stringify([{ ...first, ...change }])
    for (const json of [
      'not json',
      '{"number":1}',
      changed({ number: '103' }),
      changed({ number: 0 }),
      changed({ number: 1.5 }),
      changed({ author: null }),
      changed({ author: { name: 'no login' } }),
      changed({ isDraft: 'no' }),
      changed({ title: undefined })
    ])
      expect(parsePullRequests(json)).toBe(null)
  })
})
