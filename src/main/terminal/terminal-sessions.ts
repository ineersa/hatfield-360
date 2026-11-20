import { app, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { chmod, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type IPty, spawn } from 'node-pty'
import {
  TERMINAL_CHANNELS,
  type TerminalExit,
  type TerminalSession
} from '../../shared/terminal-api'
import { defaultShell } from './default-shell'
import { terminalEnvironment } from './terminal-environment'

/** Output is sent in batches: a busy program writes thousands of small chunks a second. */
const OUTPUT_FLUSH_MS = 5
const OUTPUT_FLUSH_BYTES = 256 * 1024
/** How long a shell gets to exit after SIGHUP before its process group is killed. */
const KILL_GRACE_MS = 1500

type Session = {
  id: string
  pty: IPty
  owner: WebContents
  output: string[]
  outputBytes: number
  flushTimer: NodeJS.Timeout | null
  exited: Promise<void>
}

/** Packaged macOS builds can lose node-pty's spawn-helper exec bit, which breaks every spawn. */
async function ensureSpawnHelperExecutable(): Promise<void> {
  if (process.platform !== 'darwin') return
  const packageRoot = dirname(dirname(require.resolve('node-pty/lib/unixTerminal.js')))
  const helper = join(packageRoot, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper').replace(
    /app\.asar([/\\])/,
    'app.asar.unpacked$1'
  )
  try {
    const { mode } = await stat(helper)
    if ((mode & 0o111) === 0) await chmod(helper, mode | 0o755)
  } catch (error) {
    console.warn('Checking the node-pty spawn helper failed:', error)
  }
}

/** Shells in ptys, each owned by the window that started it and ended with it. */
class TerminalSessions {
  private readonly sessions = new Map<string, Session>()
  private readonly trackedOwners = new WeakSet<WebContents>()
  private helperChecked: Promise<void> | null = null

  async spawn(
    owner: WebContents,
    request: { cwd: string; cols: number; rows: number }
  ): Promise<TerminalSession> {
    this.helperChecked ??= ensureSpawnHelperExecutable()
    await this.helperChecked
    const shell = defaultShell(process.env, process.platform)
    const pty = spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols: request.cols,
      rows: request.rows,
      cwd: request.cwd,
      env: terminalEnvironment(process.env, {
        platform: process.platform,
        appVersion: app.getVersion()
      }),
      ...(process.platform === 'win32' ? { useConptyDll: true } : {})
    })
    const id = randomUUID()
    const session: Session = {
      id,
      pty,
      owner,
      output: [],
      outputBytes: 0,
      flushTimer: null,
      exited: new Promise((resolve) => pty.onExit(() => resolve()))
    }
    this.sessions.set(id, session)
    this.endWithOwner(owner)
    pty.onData((data) => this.queueOutput(session, data))
    pty.onExit(({ exitCode, signal }) => {
      this.flushOutput(session)
      this.sessions.delete(id)
      const exit: TerminalExit = { id, exitCode, signal: signal ?? null }
      if (!owner.isDestroyed()) owner.send(TERMINAL_CHANNELS.exit, exit)
    })
    return { id, pid: pty.pid, shell: shell.file }
  }

  write(owner: WebContents, id: string, data: string): void {
    this.owned(owner, id)?.pty.write(data)
  }

  resize(owner: WebContents, id: string, cols: number, rows: number): void {
    const session = this.owned(owner, id)
    if (!session) return
    try {
      session.pty.resize(cols, rows)
    } catch {
      // The shell exited between the renderer's fit and this call.
    }
  }

  kill(owner: WebContents, id: string): Promise<void> {
    const session = this.owned(owner, id)
    return session ? this.end(session) : Promise.resolve()
  }

  /** Ends every shell; quitting waits for this, so no process outlives the app. */
  async killAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => this.end(session)))
  }

  /** SIGHUP like a closed terminal window, then SIGKILL for the process group if it lingers. */
  private async end(session: Session): Promise<void> {
    try {
      session.pty.kill()
    } catch {
      // Already gone.
    }
    let timer: NodeJS.Timeout | null = null
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), KILL_GRACE_MS)
    })
    const lingered = await Promise.race([session.exited.then(() => false), timedOut])
    if (timer) clearTimeout(timer)
    if (!lingered) return
    if (process.platform !== 'win32') {
      try {
        process.kill(-session.pty.pid, 'SIGKILL')
      } catch {
        // The group is gone or was never separate from the shell.
      }
    }
    try {
      session.pty.kill(process.platform === 'win32' ? undefined : 'SIGKILL')
    } catch {
      // Already gone.
    }
  }

  private owned(owner: WebContents, id: string): Session | null {
    const session = this.sessions.get(id)
    if (!session) return null
    if (session.owner !== owner) throw new Error('This terminal belongs to another window.')
    return session
  }

  private endWithOwner(owner: WebContents): void {
    if (this.trackedOwners.has(owner)) return
    this.trackedOwners.add(owner)
    owner.once('destroyed', () => {
      for (const session of this.sessions.values()) {
        if (session.owner === owner) void this.end(session)
      }
    })
  }

  private queueOutput(session: Session, data: string): void {
    session.output.push(data)
    session.outputBytes += data.length
    if (session.outputBytes >= OUTPUT_FLUSH_BYTES) {
      this.flushOutput(session)
      return
    }
    session.flushTimer ??= setTimeout(() => this.flushOutput(session), OUTPUT_FLUSH_MS)
  }

  private flushOutput(session: Session): void {
    if (session.flushTimer) clearTimeout(session.flushTimer)
    session.flushTimer = null
    if (session.output.length === 0) return
    const data = session.output.join('')
    session.output = []
    session.outputBytes = 0
    if (!session.owner.isDestroyed()) session.owner.send(TERMINAL_CHANNELS.data, session.id, data)
  }
}

export const terminalSessions = new TerminalSessions()
