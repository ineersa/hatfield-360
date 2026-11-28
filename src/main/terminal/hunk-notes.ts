import { spawn } from 'node:child_process'
import { delimiter, dirname } from 'node:path'
import { noteCount, sessionAmong } from './hunk-session'
import { descendantPids } from './process-tree'
import { terminalEnvironment } from './terminal-environment'

/** A `hunk session` call that doesn't answer (a stuck daemon) is given up. */
const HUNK_CALL_MS = 5000

/**
 * Runs `hunk session …`, with `stdin` on its input, and gives its output, or null when it failed.
 * hunk found on the shell PATH may be a Node script (npm's install), so its folder, where nvm and
 * npm put `node` too, comes first on the PATH.
 */
export function runHunk(hunk: string, args: string[], stdin?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const env = terminalEnvironment(process.env, { platform: process.platform, appVersion: '' })
    const child = spawn(hunk, args, {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...env, PATH: [dirname(hunk), env['PATH'] ?? ''].join(delimiter), NO_COLOR: '1' }
    })
    child.stdin.on('error', () => undefined).end(stdin)
    let stdout = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    const timer = setTimeout(() => child.kill('SIGKILL'), HUNK_CALL_MS)
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? stdout : null)
    })
  })
}

/** The live hunk session among a terminal's processes; null when hunk hasn't started or has quit. */
export async function hunkSessionIn(hunk: string, terminalPid: number): Promise<string | null> {
  const pids = new Set([terminalPid, ...(await descendantPids(terminalPid))])
  const sessions = await runHunk(hunk, ['session', 'list', '--json'])
  return sessions === null ? null : sessionAmong(sessions, pids)
}

/** `hunk session comment list <session> --type <type> --json`, or null when it failed. */
export const listHunkNotes = (hunk: string, session: string, type: 'all' | 'user') =>
  runHunk(hunk, ['session', 'comment', 'list', session, '--type', type, '--json'])

/**
 * How many review notes the hunk running in a terminal holds (hunk keeps them only while it runs):
 * 0 when it has quit, or can't say.
 */
export async function hunkNoteCount(hunk: string, terminalPid: number): Promise<number> {
  const session = await hunkSessionIn(hunk, terminalPid)
  const notes = session === null ? null : await listHunkNotes(hunk, session, 'all')
  return (notes === null ? null : noteCount(notes)) ?? 0
}
