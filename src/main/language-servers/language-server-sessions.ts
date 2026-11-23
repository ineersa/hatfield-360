import type { WebContents } from 'electron'
import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import {
  LANGUAGE_SERVER_CHANNELS,
  type LanguageServerConnection,
  type LanguageServerState,
  type LanguageServerStatus
} from '../../shared/language-server-api'
import { isPlainObject } from '../../shared/plain-object'
import { isPathInside } from '../files/path-containment'
import { type ProjectChange, watchProject } from '../files/project-watch'
import { exitFailure } from './language-server-exit'
import { clientMessageVerdict, serverRequestAnswer } from './language-server-policy'
import type {
  LanguageServerDefinition,
  ServerCommand,
  ServerConfiguration
} from './language-server-registry'

/** A server gets this long to answer `shutdown`, and again to exit after `exit`, before it is killed. */
const STOP_STEP_MS = 2000
/** The end of a server's stderr, kept for the failure message. */
const LOG_LINES = 40
/** Main's own requests (its `shutdown`) use ids the page's client never does. */
const MAIN_REQUEST_ID = 'hatfield-main-shutdown'

type Session = {
  connection: LanguageServerConnection
  definition: LanguageServerDefinition
  configuration: ServerConfiguration
  owner: WebContents
  child: ChildProcess
  writer: StreamMessageWriter
  log: string[]
  /** The page's `initialize` request; its response means the server is ready. */
  initializeId: unknown
  /** The page's messages still being checked, so they reach the server in order. */
  queue: Promise<void>
  /** Set once main starts shutting the server down; only main ever does. */
  stopping: Promise<void> | null
  /** Resolves when the server answers main's `shutdown`. */
  shutDown: () => void
  exited: Promise<void>
  /** Why main stopped it as failed (it refused to start), reported once it has exited. */
  failure: string | null
  /** The page's client has sent `initialized`, so the server takes other notifications. */
  initialized: boolean
  /** Stops hearing of files changed on disk under the root, which reach the server from main. */
  unwatch: () => void
}

/** LSP's file change types. */
const FILE_CHANGE_TYPES = { add: 1, change: 2, unlink: 3 } as const

/** Whether `promise` settled within `ms`. */
async function within(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), ms)))
  const settled = await Promise.race([promise.then(() => true), late])
  clearTimeout(timer)
  return settled
}

/** Every message written carries `jsonrpc: '2.0'`; the policy has already checked the page's. */
const write = (writer: StreamMessageWriter, message: Record<string, unknown>): Promise<void> =>
  writer.write({ ...message, jsonrpc: '2.0' })

const key = (owner: WebContents, server: string, root: string): string =>
  JSON.stringify([owner.id, server, root])

class LanguageServerSessions {
  private readonly sessions = new Map<string, Session>()
  private readonly byKey = new Map<string, Session>()
  private readonly watchedOwners = new WeakSet<WebContents>()

  /**
   * A server of `server` the page already runs, the latest started, for a file outside any project
   * (a library source it jumped to); null when it runs none.
   */
  running(owner: WebContents, server: string): LanguageServerConnection | null {
    const sessions = [...this.sessions.values()].filter(
      (session) =>
        session.owner === owner && session.connection.server === server && !session.stopping
    )
    return sessions.at(-1)?.connection ?? null
  }

  /** The running server for `root`, or a new one started for the page. */
  connect(
    owner: WebContents,
    definition: LanguageServerDefinition,
    command: ServerCommand,
    root: string,
    folder: string,
    configuration: ServerConfiguration,
    libraries: string[]
  ): LanguageServerConnection {
    const existing = this.byKey.get(key(owner, definition.name, root))
    if (existing && !existing.stopping) return existing.connection
    const connection: LanguageServerConnection = {
      id: randomUUID(),
      server: definition.name,
      root,
      languages: definition.languages,
      libraries
    }
    // A script runs on the app's own executable, as plain Node.
    const [file, args] = command.node
      ? [process.execPath, [command.file, ...command.args]]
      : [command.file, command.args]
    const child = spawn(file, args, {
      cwd: root,
      env: command.node ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    const reader = new StreamMessageReader(child.stdout)
    const writer = new StreamMessageWriter(child.stdin)
    const session: Session = {
      connection,
      definition,
      configuration,
      owner,
      child,
      writer,
      log: [],
      initializeId: undefined,
      queue: Promise.resolve(),
      stopping: null,
      shutDown: () => undefined,
      failure: null,
      initialized: false,
      unwatch: watchProject(folder, (changes) => this.filesChanged(session, changes)).stop,
      exited: new Promise((resolve) => child.once('close', () => resolve()))
    }
    this.sessions.set(connection.id, session)
    this.byKey.set(key(owner, definition.name, root), session)
    this.watchOwner(owner)

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      session.log.push(...chunk.split(/\r?\n/).filter(Boolean))
      session.log.splice(0, Math.max(0, session.log.length - LOG_LINES))
    })
    child.once('error', (error) => session.log.push(error.message))
    // Writing to a server that just died fails; its exit is what gets reported.
    child.stdin.on('error', () => undefined)
    reader.listen((message) => this.fromServer(session, message))
    child.once('close', (code, signal) => this.closed(session, code, signal))
    this.status(session, 'starting')
    return connection
  }

  /** Passes a page's message on to its server, when the policy allows it, in the order sent. */
  send(
    owner: WebContents,
    id: string,
    message: unknown,
    folders: () => Promise<string[]>
  ): Promise<void> {
    const session = this.owned(owner, id)
    if (!session || session.stopping) return Promise.resolve()
    // Checking a message takes a varying time; the server must still get them in order.
    const sent = session.queue.then(() => this.forward(session, message, folders))
    session.queue = sent.catch(() => undefined)
    return sent
  }

  private async forward(
    session: Session,
    message: unknown,
    folders: () => Promise<string[]>
  ): Promise<void> {
    if (session.stopping) return
    const verdict = await clientMessageVerdict(
      message,
      session.connection.root,
      await folders(),
      session.configuration.initializationOptions
    )
    if (session.stopping) return
    if (verdict.action === 'drop') {
      console.warn(`Dropped a message for the ${session.definition.name} server: ${verdict.reason}`)
      return
    }
    const { method } = verdict.message
    if (method === 'initialize') session.initializeId = verdict.message['id']
    await write(session.writer, verdict.message)
    if (method === 'initialized') session.initialized = true
    // Servers that read settings only when pushed (the JSON server) get them once started.
    if (method === 'initialized' && session.configuration.settings) {
      await write(session.writer, {
        method: 'workspace/didChangeConfiguration',
        params: { settings: session.configuration.settings }
      })
    }
  }

  disconnect(owner: WebContents, id: string): Promise<void> {
    const session = this.owned(owner, id)
    return session ? this.stop(session) : Promise.resolve()
  }

  /** Stops the servers whose root is no longer inside any of `folders`. */
  async keepInside(folders: string[]): Promise<void> {
    const outside = [...this.sessions.values()].filter(
      (session) => !folders.some((folder) => isPathInside(session.connection.root, folder))
    )
    await Promise.all(outside.map((session) => this.stop(session)))
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => this.stop(session)))
  }

  private owned(owner: WebContents, id: unknown): Session | undefined {
    const session = typeof id === 'string' ? this.sessions.get(id) : undefined
    return session?.owner === owner ? session : undefined
  }

  private fromServer(session: Session, message: unknown): void {
    if (!isPlainObject(message)) return
    if (message['id'] === MAIN_REQUEST_ID) {
      session.shutDown()
      return
    }
    const answer = serverRequestAnswer(
      message,
      session.connection.root,
      session.configuration.settings ?? {}
    )
    if (answer) {
      void write(session.writer, answer).catch(() => undefined)
      return
    }
    if (
      session.initializeId !== undefined &&
      message['id'] === session.initializeId &&
      !('method' in message)
    ) {
      if ('error' in message) {
        const { error } = message
        const reason =
          isPlainObject(error) && typeof error['message'] === 'string'
            ? error['message']
            : 'no reason given'
        session.failure = `The ${session.connection.server} language server couldn't start: ${reason}`
        void this.stop(session)
      } else {
        this.status(session, 'ready')
      }
    }
    this.toPage(session, LANGUAGE_SERVER_CHANNELS.message, session.connection.id, message)
  }

  /** Tells the server about files changed on disk, as a client watching its project would. */
  private filesChanged(session: Session, changes: ProjectChange[]): void {
    if (!session.initialized || session.stopping) return
    const inside = changes.filter((change) => isPathInside(change.path, session.connection.root))
    if (inside.length === 0) return
    const params = {
      changes: inside.map((change) => ({
        uri: pathToFileURL(change.path).href,
        type: FILE_CHANGE_TYPES[change.kind]
      }))
    }
    void write(session.writer, { method: 'workspace/didChangeWatchedFiles', params }).catch(
      () => undefined
    )
  }

  /** LSP's shutdown: `shutdown`, its answer, then `exit`; a server slow at either step is killed. */
  private stop(session: Session): Promise<void> {
    session.stopping ??= (async () => {
      const { child, writer } = session
      const running = (): boolean => child.exitCode === null && child.signalCode === null
      const answered = new Promise<void>((resolve) => (session.shutDown = resolve))
      if (running()) {
        await write(writer, { id: MAIN_REQUEST_ID, method: 'shutdown' }).catch(() => undefined)
        await within(Promise.race([answered, session.exited]), STOP_STEP_MS)
      }
      if (running()) {
        await write(writer, { method: 'exit' }).catch(() => undefined)
        if (!(await within(session.exited, STOP_STEP_MS))) child.kill('SIGKILL')
      }
      await session.exited
    })()
    return session.stopping
  }

  private closed(session: Session, code: number | null, signal: NodeJS.Signals | null): void {
    const { connection, owner } = session
    session.unwatch()
    this.sessions.delete(connection.id)
    if (this.byKey.get(key(owner, connection.server, connection.root)) === session) {
      this.byKey.delete(key(owner, connection.server, connection.root))
    }
    const failure = exitFailure(connection.server, {
      refused: session.failure,
      requested: session.stopping !== null,
      code,
      signal
    })
    if (failure === null) this.status(session, 'stopped')
    else this.status(session, 'failed', [failure, ...session.log].join('\n'))
  }

  private status(session: Session, state: LanguageServerState, message?: string): void {
    const status: LanguageServerStatus = {
      id: session.connection.id,
      state,
      ...(message === undefined ? {} : { message })
    }
    this.toPage(session, LANGUAGE_SERVER_CHANNELS.status, status)
  }

  private toPage(session: Session, channel: string, ...args: unknown[]): void {
    if (!session.owner.isDestroyed()) session.owner.send(channel, ...args)
  }

  private watchOwner(owner: WebContents): void {
    if (this.watchedOwners.has(owner)) return
    this.watchedOwners.add(owner)
    // A reloaded page starts its clients over, so its servers go with the old page.
    const stopOwned = (): void => {
      for (const session of this.sessions.values()) {
        if (session.owner === owner) void this.stop(session)
      }
    }
    owner.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) stopOwned()
    })
    owner.once('destroyed', stopOwned)
  }
}

export const languageServerSessions = new LanguageServerSessions()
