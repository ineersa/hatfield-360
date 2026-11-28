import { randomUUID } from 'node:crypto'
import { app, type WebContents } from 'electron'
import type { HunkKind, HunkLaunch, HunkNotesSave } from '../../shared/source-control-api'
import { diffBase, query } from '../git/source-control'
import {
  gitHubTokenEnv,
  pullRequestRepository,
  validPullRequest,
  validReviewBase
} from '../git/review'
import { stashToShow } from '../git/stash'
import { UnsupportedAgentShell } from './agent-shell-command'
import { notesFileName } from './hunk-note-format'
import { HunkNotes, notesFile } from './hunk-notes'
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

/** While hunk runs, its notes are also saved this often: quitting it with q skips the tab's close. */
const NOTES_SNAPSHOT_MS = 30_000

/** The notes of each hunk terminal, by terminal id, with the window that owns it. */
const tabNotes = new Map<string, { owner: WebContents; notes: HunkNotes }>()

/**
 * What a tab's notes are kept under: its repository, kind and target, and for a branch review the
 * branch too. Log has none: its notes belong to whichever commit was open.
 */
async function notesName(root: string, view: { kind: HunkKind; target: unknown }) {
  if (view.kind === 'log') return null
  const target = typeof view.target === 'string' ? view.target : ''
  const branch =
    view.kind === 'branch'
      ? (await query(root, ['branch', '--show-current'])).stdout.trim() || 'HEAD'
      : ''
  return notesFileName([root, view.kind, target, branch])
}

/** Saves the notes of the hunk in the window's terminal; nothing to save for another terminal. */
export function saveHunkNotes(owner: WebContents, terminalId: string): Promise<HunkNotesSave> {
  const tab = tabNotes.get(terminalId)
  if (tab?.owner !== owner) return Promise.resolve({ status: 'saved', count: null })
  return tab.notes.save()
}

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
  const args = await HUNK_ARGS[view.kind](place.root, view.target)
  const name = await notesName(place.root, view)
  const id = randomUUID()
  let snapshots: NodeJS.Timeout | undefined
  try {
    const terminal = await terminalSessions.spawn(
      owner,
      { cwd: place.root, ...size },
      {
        id,
        project: place.project,
        executable: hunk,
        args,
        // hunk reads a token only from its environment; a private repository needs one.
        env: view.kind === 'pull-request' ? await gitHubTokenEnv(place.root) : {},
        beforeEnd: async () => {
          await tabNotes.get(id)?.notes.save()
        },
        onExit: () => {
          clearInterval(snapshots)
          tabNotes.get(id)?.notes.stop()
          tabNotes.delete(id)
          return undefined
        }
      }
    )
    if (name !== null) {
      const notes = new HunkNotes(hunk, terminal.pid, notesFile(app.getPath('userData'), name))
      tabNotes.set(id, { owner, notes })
      snapshots = setInterval(() => void notes.save(), NOTES_SNAPSHOT_MS)
    }
    return { status: 'started', terminal }
  } catch (error) {
    if (error instanceof UnsupportedAgentShell)
      throw new Error('hunk terminals require Bash, Zsh or Fish as your default shell.', {
        cause: error
      })
    throw error
  }
}
