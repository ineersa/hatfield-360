import { spawn } from 'node:child_process'
import { isPlainObject } from '../../shared/plain-object'
import type {
  GitHubRemote,
  PullRequest,
  PullRequestList,
  RepositoryReview
} from '../../shared/review-api'
import { findOnShellPath } from '../terminal/shell-lookup'
import { terminalEnvironment } from '../terminal/terminal-environment'
import { query } from './source-control'

/** Tried in order when `origin/HEAD` isn't set (a clone sets it, a pushed `git init` doesn't). */
const BASE_CANDIDATES = ['origin/main', 'origin/master', 'main', 'master']

/** A `gh` call that hangs (a network stall) is given up, and counts as failed. */
const GH_TIMEOUT_MS = 30_000

const PULL_REQUEST_FIELDS = 'number,title,author,headRefName,isDraft,url'

/** `gh` exits with 4 when it isn't signed in. */
const SIGNED_OUT_EXIT = 4

/** How long a `gh` lookup on the shell PATH is reused: every focus reads each repository again. */
const GH_LOOKUP_TTL_MS = 60_000
const ghLookups = new Map<string, { at: number; path: Promise<string | null> }>()

/** The user's `gh`, as their shell finds it in `root`, looked up at most once a minute. */
function findGh(root: string): Promise<string | null> {
  const cached = ghLookups.get(root)
  if (cached && Date.now() - cached.at < GH_LOOKUP_TTL_MS) return cached.path
  const path = findOnShellPath('gh', root)
  ghLookups.set(root, { at: Date.now(), path })
  return path
}

const refExists = async (root: string, ref: string): Promise<boolean> =>
  (await query(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]))
    .exitCode === 0

/** The branch Review Branch compares the current one with by default, or null when none exists. */
export async function reviewBase(root: string): Promise<string | null> {
  const head = await query(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  const remoteHead = head.exitCode === 0 ? head.stdout.trim() : ''
  for (const candidate of [remoteHead, ...BASE_CANDIDATES]) {
    if (candidate !== '' && (await refExists(root, candidate))) return candidate
  }
  return null
}

/** A base the renderer asked for: an existing commit-ish named plainly, never an option. */
export async function validReviewBase(root: string, base: unknown): Promise<string> {
  if (
    typeof base !== 'string' ||
    base === '' ||
    base.length > 1000 ||
    base.startsWith('-') ||
    /[\s\p{Cc}]/u.test(base) ||
    !(await refExists(root, base))
  )
    throw new Error('Invalid base branch.')
  return base
}

/**
 * The GitHub repository an `origin` URL names: `git@github.com:o/r.git`, `ssh://git@github.com/o/r`,
 * `https://github.com/o/r.git`, or the same on a `<tenant>.ghe.com` host. Null for anything else.
 */
export function gitHubRemote(url: string): GitHubRemote | null {
  const match =
    /^(?:(?:[\w.-]+@)?(?<scpHost>[\w.-]+):(?!\/\/)|(?:ssh|https?|git):\/\/(?:[^@/]+@)?(?<urlHost>[\w.-]+)(?::\d+)?\/)(?<owner>[\w.-]+)\/(?<repo>[\w.-]+?)(?:\.git)?\/?$/.exec(
      url.trim()
    )
  const named = (match?.groups?.['scpHost'] ?? match?.groups?.['urlHost'])?.toLowerCase()
  // GitHub's SSH over port 443.
  const host = named === 'ssh.github.com' ? 'github.com' : named
  const owner = match?.groups?.['owner']
  const repo = match?.groups?.['repo']
  if (host === undefined || owner === undefined || repo === undefined) return null
  if (host !== 'github.com' && !host.endsWith('.ghe.com')) return null
  return { host, owner, repo }
}

async function originOnGitHub(root: string): Promise<GitHubRemote | null> {
  const url = await query(root, ['remote', 'get-url', 'origin'])
  return url.exitCode === 0 ? gitHubRemote(url.stdout) : null
}

const repositoryName = (github: GitHubRemote): string =>
  `${github.host}/${github.owner}/${github.repo}`

/** `host/owner/repo` of origin, for `hunk gh pr --repo`. */
export async function pullRequestRepository(root: string): Promise<string> {
  const github = await originOnGitHub(root)
  if (github === null) throw new Error('origin is not a GitHub repository.')
  return repositoryName(github)
}

type GhRun = { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }

/** Runs the user's `gh` in `root`, as their shell would find it; its output is only read here. */
function runGh(gh: string, root: string, args: string[]): Promise<GhRun> {
  return new Promise((resolve) => {
    const child = spawn(gh, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...terminalEnvironment(process.env, { platform: process.platform, appVersion: '' }),
        GH_PROMPT_DISABLED: '1',
        NO_COLOR: '1'
      }
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, GH_TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ exitCode: null, stdout: '', stderr: error.message, timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code, stdout, stderr, timedOut })
    })
  })
}

const text = (value: unknown): value is string => typeof value === 'string'

/** One pull request of `gh pr list/view --json`, or null when it doesn't have the expected shape. */
function pullRequestOf(value: unknown): PullRequest | null {
  if (!isPlainObject(value)) return null
  const { number, title, author, headRefName, isDraft, url } = value
  if (
    typeof number !== 'number' ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    !text(title) ||
    !text(headRefName) ||
    typeof isDraft !== 'boolean' ||
    !text(url) ||
    !isPlainObject(author) ||
    !text(author['login'])
  )
    return null
  return { number, title, author: author['login'], branch: headRefName, draft: isDraft, url }
}

/** `gh pr list --json` output, every entry checked; null when it isn't such a list. */
export function parsePullRequests(json: string): PullRequest[] | null {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  if (!Array.isArray(value)) return null
  const pullRequests = value.map(pullRequestOf)
  return pullRequests.every((each) => each !== null) ? pullRequests : null
}

/** The open pull requests of the repository's GitHub `origin`, or why there are none to show. */
export async function listPullRequests(root: string): Promise<PullRequestList> {
  const github = await originOnGitHub(root)
  if (github === null) return { status: 'failed', output: 'origin is not a GitHub repository.' }
  const gh = await findGh(root)
  if (gh === null) return { status: 'no-gh' }
  const run = await runGh(gh, root, [
    'pr',
    'list',
    '--repo',
    repositoryName(github),
    '--state',
    'open',
    '--limit',
    '200',
    '--json',
    PULL_REQUEST_FIELDS
  ])
  if (run.timedOut)
    return { status: 'failed', output: `gh did not answer within ${GH_TIMEOUT_MS / 1000} s.` }
  if (run.exitCode === SIGNED_OUT_EXIT) return { status: 'signed-out', host: github.host }
  if (run.exitCode !== 0)
    return { status: 'failed', output: run.stderr.trim() || `gh exited with ${run.exitCode}` }
  const pullRequests = parsePullRequests(run.stdout)
  return pullRequests === null
    ? { status: 'failed', output: 'gh listed the pull requests in a form this app does not know.' }
    : { status: 'listed', pullRequests }
}

/** The current branch's open pull request on origin; null when there is none or `gh` can't say. */
async function currentPullRequest(root: string, github: GitHubRemote): Promise<PullRequest | null> {
  const branch = (await query(root, ['branch', '--show-current'])).stdout.trim()
  // Detached, or a name gh would take for an option (git doesn't allow those).
  if (branch === '' || branch.startsWith('-')) return null
  const gh = await findGh(root)
  if (gh === null) return null
  const run = await runGh(gh, root, [
    'pr',
    'view',
    branch,
    '--repo',
    repositoryName(github),
    '--json',
    `${PULL_REQUEST_FIELDS},state,isCrossRepository`
  ])
  if (run.exitCode !== 0) return null
  try {
    const value: unknown = JSON.parse(run.stdout)
    // A fork's PR from a branch of the same name isn't this branch's.
    if (!isPlainObject(value) || value['state'] !== 'OPEN' || value['isCrossRepository'] !== false)
      return null
    return pullRequestOf(value)
  } catch {
    return null
  }
}

export async function repositoryReview(root: string): Promise<RepositoryReview> {
  const [base, github] = await Promise.all([reviewBase(root), originOnGitHub(root)])
  return {
    base,
    github,
    pullRequest: github === null ? null : await currentPullRequest(root, github)
  }
}

/**
 * `GH_TOKEN` for `hunk gh`, which reads only the environment: the signed-in `gh`'s token for the
 * remote's host. Nothing when the user already set one, or `gh` has none. It goes only into that
 * hunk's environment: never logged, stored or sent to the renderer.
 */
export async function gitHubTokenEnv(root: string): Promise<Record<string, string>> {
  if (process.env['GH_TOKEN'] || process.env['GITHUB_TOKEN']) return {}
  const github = await originOnGitHub(root)
  const gh = github === null ? null : await findGh(root)
  if (github === null || gh === null) return {}
  const run = await runGh(gh, root, ['auth', 'token', '--hostname', github.host])
  const token = run.stdout.trim()
  return run.exitCode === 0 && token !== '' && !/\s/.test(token) ? { GH_TOKEN: token } : {}
}

/** A pull request number the renderer asked for. */
export function validPullRequest(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value))
    throw new Error('Invalid pull request.')
  return value
}
