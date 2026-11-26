import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { HunkKind, HunkLaunch } from '../../shared/source-control-api'
import { UnsupportedAgentShell } from './agent-shell-command'
import { findOnShellPath } from './shell-lookup'
import { terminalSessions } from './terminal-sessions'

const HUNK_ARGS: Record<HunkKind, string[]> = { review: ['diff', '--watch'], log: ['log'] }

/**
 * Runs hunk in a terminal in `root`, found afresh on the user's shell PATH each time so installing
 * it and trying again works.
 */
export async function launchHunk(
  owner: WebContents,
  place: { root: string; project: string },
  kind: HunkKind,
  size: { cols: number; rows: number }
): Promise<HunkLaunch> {
  const hunk = await findOnShellPath('hunk', place.root)
  if (hunk === null) return { status: 'missing' }
  try {
    const terminal = await terminalSessions.spawn(
      owner,
      { cwd: place.root, ...size },
      { id: randomUUID(), project: place.project, executable: hunk, args: HUNK_ARGS[kind], env: {} }
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
