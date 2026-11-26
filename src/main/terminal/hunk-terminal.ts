import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { HunkLaunch } from '../../shared/source-control-api'
import { fileDiffSpec } from '../git/source-control'
import { UnsupportedAgentShell } from './agent-shell-command'
import { findOnShellPath } from './shell-lookup'
import { terminalSessions } from './terminal-sessions'

/** hunk's arguments for a view the renderer asked for; a diff's file is checked to be inside `root`. */
export async function hunkArgs(
  root: string,
  view: { kind?: unknown; path?: unknown }
): Promise<string[]> {
  switch (view.kind) {
    case 'review':
      return ['diff', '--watch']
    case 'log':
      return ['log']
    case 'diff': {
      const { base, pathspecs } = await fileDiffSpec(root, view.path)
      return ['diff', '--watch', base, '--', ...pathspecs]
    }
    default:
      throw new Error('Invalid hunk request.')
  }
}

/**
 * Runs hunk in a terminal in `root`, found afresh on the user's shell PATH each time so installing
 * it and trying again works.
 */
export async function launchHunk(
  owner: WebContents,
  place: { root: string; project: string },
  args: string[],
  size: { cols: number; rows: number }
): Promise<HunkLaunch> {
  const hunk = await findOnShellPath('hunk', place.root)
  if (hunk === null) return { status: 'missing' }
  try {
    const terminal = await terminalSessions.spawn(
      owner,
      { cwd: place.root, ...size },
      { id: randomUUID(), project: place.project, executable: hunk, args, env: {} }
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
