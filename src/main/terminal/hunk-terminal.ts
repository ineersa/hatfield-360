import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { HunkKind, HunkLaunch } from '../../shared/source-control-api'
import { diffBase } from '../git/source-control'
import { stashToShow } from '../git/stash'
import { UnsupportedAgentShell } from './agent-shell-command'
import { findOnShellPath } from './shell-lookup'
import { terminalSessions } from './terminal-sessions'

/** Review compares with HEAD, not the index, so staged changes show too, as the Commit panel lists them. */
async function hunkArgs(root: string, kind: HunkKind, stash: unknown): Promise<string[]> {
  if (kind === 'review') return ['diff', '--watch', await diffBase(root)]
  return kind === 'log' ? ['log'] : ['stash', 'show', await stashToShow(root, stash)]
}

/**
 * Runs hunk in a terminal in `root`, found afresh on the user's shell PATH each time so installing
 * it and trying again works.
 */
export async function launchHunk(
  owner: WebContents,
  place: { root: string; project: string },
  view: { kind: HunkKind; stash: unknown },
  size: { cols: number; rows: number }
): Promise<HunkLaunch> {
  const hunk = await findOnShellPath('hunk', place.root)
  if (hunk === null) return { status: 'missing' }
  try {
    const terminal = await terminalSessions.spawn(
      owner,
      { cwd: place.root, ...size },
      {
        id: randomUUID(),
        project: place.project,
        executable: hunk,
        args: await hunkArgs(place.root, view.kind, view.stash),
        env: {}
      }
    )
    return { status: 'started', terminal }
  } catch (error) {
    if (error instanceof UnsupportedAgentShell)
      throw new Error('hunk terminals require Bash, Zsh or Fish as your default shell.', {
        cause: error
      })
    throw error
  }
}
