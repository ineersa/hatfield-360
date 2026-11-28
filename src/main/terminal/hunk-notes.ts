import { spawn } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { isPlainObject } from '../../shared/plain-object'
import type { HunkNotesSave } from '../../shared/source-control-api'
import {
  applyBatch,
  notesFromList,
  parseSavedNotes,
  type SavedNote,
  savedNotesText,
  sessionAmong
} from './hunk-note-format'
import { descendantPids } from './process-tree'
import { terminalEnvironment } from './terminal-environment'

/** One `hunk session` call that doesn't answer (a stuck daemon) is given up. */
const HUNK_CALL_MS = 5000
/** How long a starting hunk (a pull request still downloading) is waited for to put notes back. */
const SESSION_WAIT_MS = 60_000
const SESSION_POLL_MS = 500

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type HunkRun = { exitCode: number | null; stdout: string; stderr: string }

/**
 * Runs `hunk session …`. hunk found on the shell PATH may be a Node script (npm's install), so the
 * folder it's in, where nvm and npm put `node` too, comes first on the PATH.
 */
function runHunk(hunk: string, args: string[], stdin?: string): Promise<HunkRun> {
  return new Promise((resolve) => {
    const env = terminalEnvironment(process.env, { platform: process.platform, appVersion: '' })
    const child = spawn(hunk, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...env, PATH: [dirname(hunk), env['PATH'] ?? ''].join(delimiter), NO_COLOR: '1' }
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    const timer = setTimeout(() => child.kill('SIGKILL'), HUNK_CALL_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ exitCode: null, stdout: '', stderr: error.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code, stdout, stderr })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(stdin ?? '')
  })
}

const failure = (run: HunkRun, what: string): string =>
  run.stderr.trim().replace(/^hunk:\s*/, '') || `${what} failed (exit ${run.exitCode}).`

/**
 * A hunk tab's notes, kept across runs: put back into the session when it starts, and written to
 * `file` whenever saved. Notes that couldn't be put back (their line left the diff) are kept too.
 */
export class HunkNotes {
  /** Saved notes the session hasn't taken back. */
  private leftover: SavedNote[] = []
  /** Until the saved notes are back in the session, saving would lose them: it waits. */
  private restored: Promise<void>
  private restoring = true
  private stopped = false

  constructor(
    private readonly hunk: string,
    private readonly terminalPid: number,
    private readonly file: string
  ) {
    this.restored = this.restore().finally(() => (this.restoring = false))
  }

  /** The hunk session running in the terminal, or null when there is none (not started, or quit). */
  private async session(): Promise<string | null> {
    const pids = new Set([this.terminalPid, ...(await descendantPids(this.terminalPid))])
    const run = await runHunk(this.hunk, ['session', 'list', '--json'])
    return run.exitCode === 0 ? sessionAmong(run.stdout, pids) : null
  }

  private async restore(): Promise<void> {
    const saved = parseSavedNotes(await readFile(this.file, 'utf8').catch(() => ''))
    if (saved.length === 0) return
    this.leftover = saved
    let session: string | null = null
    for (let waited = 0; session === null && !this.stopped && waited < SESSION_WAIT_MS;) {
      session = await this.session()
      if (session === null) {
        await delay(SESSION_POLL_MS)
        waited += SESSION_POLL_MS
      }
    }
    if (session === null) return
    // One batch is checked whole: a note whose file or line left the diff would refuse them all.
    const apply = (notes: readonly SavedNote[]) =>
      runHunk(
        this.hunk,
        ['session', 'comment', 'apply', session, '--stdin', '--focus'],
        applyBatch(notes)
      )
    if ((await apply(saved)).exitCode === 0) {
      this.leftover = []
      return
    }
    const kept: SavedNote[] = []
    for (const note of saved) if ((await apply([note])).exitCode !== 0) kept.push(note)
    this.leftover = kept
  }

  /** Writes the session's notes, and the saved ones it didn't take back, to the file. */
  async save(): Promise<HunkNotesSave> {
    // Not started yet, or already quit: what was last saved stays as it is.
    if ((await this.session()) === null) return { status: 'saved', count: null }
    if (this.restoring) await this.restored
    const session = await this.session()
    if (session === null) return { status: 'saved', count: null }
    const run = await runHunk(this.hunk, [
      'session',
      'comment',
      'list',
      session,
      '--type',
      'all',
      '--json'
    ])
    const live = run.exitCode === 0 ? notesFromList(run.stdout) : null
    if (live === null) return { status: 'failed', message: failure(run, 'Listing the notes') }
    const notes = [...live, ...this.leftover]
    try {
      if (notes.length === 0) await rm(this.file, { force: true })
      else {
        await mkdir(dirname(this.file), { recursive: true })
        const partial = `${this.file}.${process.pid}.tmp`
        await writeFile(partial, savedNotesText(notes), { mode: 0o600 })
        await rename(partial, this.file)
      }
    } catch (error) {
      const code =
        isPlainObject(error) && typeof error['code'] === 'string' ? ` (${error['code']})` : ''
      return { status: 'failed', message: `Writing them to the app's data folder failed${code}.` }
    }
    return { status: 'saved', count: notes.length }
  }

  stop(): void {
    this.stopped = true
  }
}

/** Where a review's notes are kept, in the app's data folder. */
export const notesFile = (folder: string, name: string): string => join(folder, 'hunk-notes', name)
