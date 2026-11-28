import { isPlainObject } from '../../shared/plain-object'
import type { GitHubRemote } from '../../shared/review-api'
import { DISCUSSION_QUERY, type Discussion, parseDiscussion } from './pull-request-discussion'
import { findGh, GH_TIMEOUT_MS, type GhRun, originOnGitHub, runGh, SIGNED_OUT_EXIT } from './review'

/** Why a `gh` call failed, in words for the user. */
function ghFailure(run: GhRun, host: string): string {
  if (run.timedOut) return `gh did not answer within ${GH_TIMEOUT_MS / 1000} s.`
  if (run.exitCode === SIGNED_OUT_EXIT) return `gh isn't signed in to ${host}: run gh auth login.`
  return run.stderr.trim() || `gh exited with ${run.exitCode}.`
}

/** The user's gh and origin's repository, or why they can't be used. */
async function gitHub(root: string): Promise<{ gh: string; github: GitHubRemote } | string> {
  const github = await originOnGitHub(root)
  if (github === null) return 'origin is not a GitHub repository.'
  const gh = await findGh(root)
  if (gh === null) return 'gh, the GitHub CLI, is not on your shell’s PATH.'
  return { gh, github }
}

/** The pull request's unresolved threads and conversation, or why they couldn't be read. */
export async function readDiscussion(root: string, number: string): Promise<Discussion | string> {
  const found = await gitHub(root)
  if (typeof found === 'string') return found
  const { gh, github } = found
  const run = await runGh(gh, root, [
    'api',
    'graphql',
    '--hostname',
    github.host,
    '-F',
    `owner=${github.owner}`,
    '-F',
    `name=${github.repo}`,
    '-F',
    `number=${number}`,
    '-f',
    `query=${DISCUSSION_QUERY}`
  ])
  if (run.exitCode !== 0) return ghFailure(run, github.host)
  return parseDiscussion(run.stdout) ?? 'GitHub answered in a form this app does not know.'
}

/**
 * Posts with `gh api`, as the signed-in user: `fields` is the JSON body. Null when it was posted,
 * else why not.
 */
export async function postToPullRequest(
  root: string,
  path: (repository: string) => string,
  fields: object
): Promise<string | null> {
  const found = await gitHub(root)
  if (typeof found === 'string') return found
  const { gh, github } = found
  const run = await runGh(
    gh,
    root,
    [
      'api',
      '--hostname',
      github.host,
      '--method',
      'POST',
      path(`repos/${github.owner}/${github.repo}`),
      '--input',
      '-'
    ],
    JSON.stringify(fields)
  )
  return run.exitCode === 0 ? null : apiFailure(run, github.host)
}

/** A refused `gh api` call: gh says the HTTP status, GitHub's JSON answer says why. */
function apiFailure(run: GhRun, host: string): string {
  let reason = ''
  try {
    const answer: unknown = JSON.parse(run.stdout)
    if (isPlainObject(answer)) {
      const errors: unknown = answer['errors']
      const listed: unknown[] = Array.isArray(errors) ? errors : []
      reason = [answer['message'], ...listed]
        .map((each) => (typeof each === 'string' ? each : JSON.stringify(each)))
        .join(' ')
    }
  } catch {
    // Not GitHub's answer: gh's own message says it.
  }
  const failure = ghFailure(run, host)
  return reason === '' ? failure : `${failure} ${reason}`
}
