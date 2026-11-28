import { app, type WebContents } from 'electron'
import { unpackedPath } from '../asar-unpacked-path'
import { randomUUID } from 'node:crypto'
import { chmod, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type IPty, spawn } from 'node-pty'
import {
  TERMINAL_CHANNELS,
  type TerminalExit,
  type TerminalSession
} from '../../shared/terminal-api'
import { agentStatusServer } from '../agent-status/status-server'
import { agentShellCommand } from './agent-shell-command'
import { defaultShell } from './default-shell'
import { descendantPids, isProcessAlive } from './process-tree'
import { terminalEnvironment } from './terminal-environment'

/** Output is sent in batches: a busy program writes thousands of small chunks a second. */
const OUTPUT_FLUSH_MS = 5
const OUTPUT_FLUSH_BYTES = 256 * 1024
/** How long a shell and its jobs get to exit after SIGHUP before they are killed. */
const KILL_GRACE_MS = 1500
const EXIT_POLL_MS = 50
/**
 * Flow control: output the page hasn't drawn yet. Past the high mark the pty stops being read (the
 * program blocks on its writes) until xterm catches up to the low mark; without it a flood
 * outruns xterm, which drops data once its buffer passes 50 MB.
 */
const UNACKED_HIGH_BYTES = 2 * 1024 * 1024
const UNACKED_LOW_BYTES = 512 * 1024

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type Session = {
  id: string
  bootstrapToken?: string
  pty: IPty
  owner: WebContents
  cwd: string
  project: string | null
  output: string[]
  outputBytes: number
  flushTimer: NodeJS.Timeout | null
  unacked: number
  paused: boolean
  /** Set once the page it was started for is gone: nothing more is sent for it. */
  detached: boolean
  exited: Promise<void>
  ending: Promise<void> | null
  onClosing: (() => void) | undefined
}

/** Packaged macOS builds can lose node-pty's spawn-helper exec bit, which breaks every spawn. */
async function ensureSpawnHelperExecutable(): Promise<void> {
  if (process.platform !== 'darwin') return
  const packageRoot = dirname(dirname(require.resolve('node-pty/lib/unixTerminal.js')))
  const helper = unpackedPath(
    join(packageRoot, 'prebuilds', `darwin-${process.arch}`, 'spawn-helper')
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
  private readonly paneClosedListeners = new Set<(owner: WebContents, id: string) => void>()

  onPaneClosed(listener: (owner: WebContents, id: string) => void): void {
    this.paneClosedListeners.add(listener)
  }

  private readonly sessions = new Map<string, Session>()
  private readonly trackedOwners = new WeakSet<WebContents>()
  /** Endings still waiting on lingering jobs; kept after their shell leaves `sessions`. */
  private readonly endings = new Set<Promise<void>>()
  private helperChecked: Promise<void> | null = null

  directory(owner: WebContents, id: string) {
    const session = this.owned(owner, id)
    return session ? { cwd: session.cwd, project: session.project } : null
  }

  manualPlacement(id: string) {
    const session = this.sessions.get(id)
    if (
      session?.bootstrapToken &&
      !session.ending &&
      !session.detached &&
      !session.owner.isDestroyed()
    )
      return { owner: session.owner, cwd: session.cwd, project: session.project }
    return undefined
  }

  async spawn(
    owner: WebContents,
    request: { cwd: string; cols: number; rows: number },
    /** A program to run through the user's shell instead of the shell itself: an agent or hunk. */
    command?: {
      id: string
      project: string | null
      executable: string
      args: string[]
      env: Record<string, string>
      onClosing?: () => void
      onExit?: () => string | undefined
    }
  ): Promise<TerminalSession> {
    this.helperChecked ??= ensureSpawnHelperExecutable()
    await this.helperChecked
    const env = terminalEnvironment(process.env, {
      platform: process.platform,
      appVersion: app.getVersion()
    })
    const shell = command
      ? agentShellCommand(command, request.cwd)
      : defaultShell(process.env, process.platform)
    const id = command?.id ?? randomUUID()
    const bootstrap = command
      ? undefined
      : await agentStatusServer
          .prepareBootstrap({ terminalId: id, cwd: request.cwd })
          .catch(() => undefined)
    const closeBootstrap = () => {
      if (bootstrap) agentStatusServer.closeBootstrap(bootstrap.token)
    }
    const pty = (() => {
      try {
        if (owner.isDestroyed()) throw new Error('The terminal window has closed.')
        return spawn(shell.file, shell.args, {
          name: 'xterm-256color',
          cols: request.cols,
          rows: request.rows,
          cwd: request.cwd,
          env: {
            ...env,
            ...command?.env,
            ...(bootstrap
              ? {
                  H360_STATUS_ENDPOINT: bootstrap.endpoint,
                  H360_STATUS_BOOTSTRAP_TOKEN: bootstrap.token
                }
              : {})
          },
          ...(process.platform === 'win32' ? { useConptyDll: true } : {})
        })
      } catch (error) {
        closeBootstrap()
        throw error
      }
    })()
    const session: Session = {
      id,
      ...(bootstrap ? { bootstrapToken: bootstrap.token } : {}),
      pty,
      owner,
      cwd: request.cwd,
      project: command?.project ?? null,
      output: [],
      outputBytes: 0,
      flushTimer: null,
      unacked: 0,
      paused: false,
      detached: false,
      exited: new Promise((resolve) => pty.onExit(() => resolve())),
      ending: null,
      onClosing: command?.onClosing
    }
    this.sessions.set(id, session)
    this.endWithOwner(owner)
    pty.onData((data) => this.queueOutput(session, data))
    pty.onExit(({ exitCode, signal }) => {
      this.flushOutput(session)
      this.sessions.delete(id)
      closeBootstrap()
      const error = command?.onExit?.()
      const exit: TerminalExit = {
        id,
        exitCode,
        signal: signal ?? null,
        ...(error ? { error } : {})
      }
      if (!session.detached && !owner.isDestroyed()) owner.send(TERMINAL_CHANNELS.exit, exit)
    })
    if (bootstrap)
      await agentStatusServer.bindBootstrap(bootstrap.token, pty.pid).catch(closeBootstrap)
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

  /** The page has drawn `bytes` more of the session's output. */
  acknowledge(owner: WebContents, id: string, bytes: number): void {
    const session = this.owned(owner, id)
    if (!session) return
    session.unacked = Math.max(0, session.unacked - bytes)
    if (session.paused && session.unacked <= UNACKED_LOW_BYTES) {
      session.paused = false
      session.pty.resume()
    }
  }

  kill(owner: WebContents, id: string): Promise<void> {
    const session = this.owned(owner, id)
    for (const listener of this.paneClosedListeners) listener(owner, id)
    return session ? this.end(session) : Promise.resolve()
  }

  /**
   * Ends every shell and waits for endings already under way (a tab closed just before quitting
   * may still be waiting out a job's grace period), so no process outlives the app.
   */
  async killAll(): Promise<void> {
    for (const session of this.sessions.values()) void this.end(session)
    await Promise.all(this.endings)
  }

  private end(session: Session): Promise<void> {
    if (!session.ending) {
      session.onClosing?.()
      if (session.bootstrapToken) agentStatusServer.closeBootstrap(session.bootstrapToken)
      const ending = this.terminate(session).finally(() => this.endings.delete(ending))
      this.endings.add(ending)
      session.ending = ending
    }
    return session.ending
  }

  /**
   * SIGHUP to the shell and everything it started, like a closed terminal window, then SIGKILL
   * for whatever still runs after the grace period. Jobs run in their own process groups and can
   * outlive the shell, so they are found up front and waited for even once the shell is gone.
   */
  private async terminate(session: Session): Promise<void> {
    const unix = process.platform !== 'win32'
    const jobs = unix ? await descendantPids(session.pty.pid) : []
    const shell = { exited: false }
    void session.exited.then(() => (shell.exited = true))
    // A paused pty would leave a program blocked on its writes instead of seeing the hangup.
    if (session.paused) {
      session.paused = false
      session.pty.resume()
    }
    try {
      session.pty.kill()
    } catch {
      // Already gone.
    }
    for (const pid of jobs) sendSignal(pid, 'SIGHUP')

    const lingering = () => jobs.filter(isProcessAlive)
    const deadline = Date.now() + KILL_GRACE_MS
    while (Date.now() < deadline && (!shell.exited || lingering().length > 0)) {
      await delay(EXIT_POLL_MS)
    }
    if (unix) for (const pid of lingering()) sendSignal(pid, 'SIGKILL')
    if (shell.exited) return
    if (unix) sendSignal(-session.pty.pid, 'SIGKILL')
    try {
      session.pty.kill(unix ? 'SIGKILL' : undefined)
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

  /**
   * A window's shells end with the page that started them: when the window closes, and when its
   * page reloads or crashes, since the new page knows nothing of them.
   */
  private endWithOwner(owner: WebContents): void {
    if (this.trackedOwners.has(owner)) return
    this.trackedOwners.add(owner)
    const endOwned = () => {
      for (const session of this.sessions.values()) {
        if (session.owner !== owner) continue
        session.detached = true
        void this.end(session)
      }
    }
    owner.once('destroyed', endOwned)
    owner.on('render-process-gone', endOwned)
    owner.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) endOwned()
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
    if (session.detached || session.owner.isDestroyed()) return
    session.owner.send(TERMINAL_CHANNELS.data, session.id, data)
    session.unacked += data.length
    if (!session.paused && session.unacked >= UNACKED_HIGH_BYTES) {
      session.paused = true
      session.pty.pause()
    }
  }
}

function sendSignal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name)
  } catch {
    // Already gone.
  }
}

export const terminalSessions = new TerminalSessions()
