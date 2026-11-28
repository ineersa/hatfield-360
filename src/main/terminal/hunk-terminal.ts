import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type {
  HunkKind,
  HunkLaunch,
  PullRequestComments,
  PullRequestPublish
} from '../../shared/source-control-api'
import { diffBase } from '../git/source-control'
import {
  gitHubTokenEnv,
  pullRequestRepository,
  validPullRequest,
  validReviewBase
} from '../git/review'
import { stashToShow } from '../git/stash'
import { UnsupportedAgentShell } from './agent-shell-command'
import { hunkNoteCount } from './hunk-notes'
import { PullRequestNotes } from './hunk-pull-request'
import { findOnShellPath } from './shell-lookup'
import { terminalSessions } from './terminal-sessions'

const HUNK_ARGS: Record<HunkKind, (root: string, target: unknown) => Promise<string[]>> = {
  // Compared with HEAD, not the index, so staged changes show too, as the Commit panel lists them.
  review: async (root) => ['diff', '--watch', await diffBase(root)],
  log: () => Promise.resolve(['log']),
  stash: async (root, target) => ['stash', 'show', await stashToShow(root, target)],
  // From where the branch left the base: the base's own later commits don't show.
  branch: async (root, target) => ['diff', `${await validReviewBase(root, target)}...HEAD`],
  // Named with origin's repository, so a fork's `upstream` remote doesn't decide which #n it is.
  'pull-request': async (root, target) => [
    'gh',
    'pr',
    validPullRequest(target),
    '--repo',
    await pullRequestRepository(root)
  ]
}

/**
 * Each hunk terminal's program and process, by terminal id, with the window that owns it, and a
 * pull request tab's GitHub discussion.
 */
const running = new Map<
  string,
  { owner: WebContents; hunk: string; pid: number; pullRequest: PullRequestNotes | null }
>()

/**
 * How many review notes closing the window's hunk terminal would lose: on a pull request tab the
 * user's own, as GitHub keeps the rest. 0 for any other terminal.
 */
export function hunkNotesIn(owner: WebContents, terminalId: string): Promise<number> {
  const terminal = running.get(terminalId)
  if (terminal?.owner !== owner) return Promise.resolve(0)
  return terminal.pullRequest
    ? terminal.pullRequest.unpublished()
    : hunkNoteCount(terminal.hunk, terminal.pid)
}

const pullRequestIn = (owner: WebContents, terminalId: string): PullRequestNotes => {
  const terminal = running.get(terminalId)
  if (terminal?.owner !== owner || terminal.pullRequest === null)
    throw new Error('That tab is not a pull request’s, or its hunk has ended.')
  return terminal.pullRequest
}

export const loadPullRequestComments = (
  owner: WebContents,
  terminalId: string
): Promise<PullRequestComments> => pullRequestIn(owner, terminalId).load()

export const publishPullRequestNotes = (
  owner: WebContents,
  terminalId: string
): Promise<PullRequestPublish> => pullRequestIn(owner, terminalId).publish()

/**
 * Runs hunk in a terminal in `root`, found afresh on the user's shell PATH each time so installing
 * it and trying again works.
 */
export async function launchHunk(
  owner: WebContents,
  place: { root: string; project: string },
  view: { kind: HunkKind; target: unknown },
  size: { cols: number; rows: number }
): Promise<HunkLaunch> {
  const hunk = await findOnShellPath('hunk', place.root)
  if (hunk === null) return { status: 'missing' }
  const id = randomUUID()
  try {
    const terminal = await terminalSessions.spawn(
      owner,
      { cwd: place.root, ...size },
      {
        id,
        project: place.project,
        executable: hunk,
        args: await HUNK_ARGS[view.kind](place.root, view.target),
        // hunk reads a token only from its environment; a private repository needs one.
        env: view.kind === 'pull-request' ? await gitHubTokenEnv(place.root) : {},
        onExit: () => {
          running.get(id)?.pullRequest?.stop()
          running.delete(id)
          return undefined
        }
      }
    )
    const pullRequest =
      view.kind === 'pull-request'
        ? new PullRequestNotes(hunk, terminal.pid, place.root, validPullRequest(view.target))
        : null
    running.set(id, { owner, hunk, pid: terminal.pid, pullRequest })
    return { status: 'started', terminal }
  } catch (error) {
    if (error instanceof UnsupportedAgentShell)
      throw new Error('hunk terminals require Bash, Zsh or Fish as your default shell.', {
        cause: error
      })
    throw error
  }
}
