import { spawn } from 'node:child_process'
import { delimiter, dirname } from 'node:path'
import { noteCount, sessionAmong } from './hunk-session'
import { descendantPids } from './process-tree'
import { terminalEnvironment } from './terminal-environment'

/** A `hunk session` call that doesn't answer (a stuck daemon) is given up. */
const HUNK_CALL_MS = 5000

/**
 * Runs `hunk session …` and gives its output, or null when it failed. hunk found on the shell PATH
 * may be a Node script (npm's install), so its folder, where nvm and npm put `node` too, comes
 * first on the PATH.
 */
function runHunk(hunk: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const env = terminalEnvironment(process.env, { platform: process.platform, appVersion: '' })
    const child = spawn(hunk, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...env, PATH: [dirname(hunk), env['PATH'] ?? ''].join(delimiter), NO_COLOR: '1' }
    })
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

/**
 * How many review notes the hunk running in a terminal holds (hunk keeps them only while it runs):
 * 0 when it has quit, or can't say.
 */
export async function hunkNoteCount(hunk: string, terminalPid: number): Promise<number> {
  const pids = new Set([terminalPid, ...(await descendantPids(terminalPid))])
  const sessions = await runHunk(hunk, ['session', 'list', '--json'])
  const session = sessions === null ? null : sessionAmong(sessions, pids)
  if (session === null) return 0
  const notes = await runHunk(hunk, [
    'session',
    'comment',
    'list',
    session,
    '--type',
    'all',
    '--json'
  ])
  return (notes === null ? null : noteCount(notes)) ?? 0
}
