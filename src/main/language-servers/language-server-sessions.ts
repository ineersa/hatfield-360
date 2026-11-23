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
import { type TreeChange, TreeWatcher } from '../files/tree-watcher'
import { clientMessageVerdict, serverRequestAnswer } from './language-server-policy'
import type {
  LanguageServerDefinition,
  ServerCommand,
  ServerConfiguration
} from './language-server-registry'

/** A server gets this long to exit after `shutdown` before it is killed. */
const STOP_GRACE_MS = 2000
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
  stopping: Promise<void> | null
  exited: Promise<void>
  /** Why main stopped it as failed (it refused to start), reported once it has exited. */
  failure: string | null
  /** The page's client has sent `initialized`, so the server takes other notifications. */
  initialized: boolean
  /** Files changed on disk under the root reach the server from here, not from the page. */
  watcher: TreeWatcher
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

  /** The running server for `root`, or a new one started for the page. */
  connect(
    owner: WebContents,
    definition: LanguageServerDefinition,
    command: ServerCommand,
    root: string,
    configuration: ServerConfiguration
  ): LanguageServerConnection {
    const existing = this.byKey.get(key(owner, definition.name, root))
    if (existing && !existing.stopping) return existing.connection
    const connection: LanguageServerConnection = {
      id: randomUUID(),
      server: definition.name,
      root,
      languages: definition.languages
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
      stopping: null,
      failure: null,
      initialized: false,
      watcher: new TreeWatcher(root, (changes) => this.filesChanged(session, changes)),
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
    void session.watcher.start()
    this.status(session, 'starting')
    return connection
  }

  /** Passes a page's message on to its server, when the policy allows it. */
  async send(owner: WebContents, id: string, message: unknown, folders: string[]): Promise<void> {
    const session = this.owned(owner, id)
    if (!session || session.stopping) return
    const verdict = clientMessageVerdict(
      message,
      session.connection.root,
      folders,
      session.configuration.initializationOptions
    )
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
    if (message['id'] === MAIN_REQUEST_ID) return
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
  private filesChanged(session: Session, changes: TreeChange[]): void {
    if (!session.initialized || session.stopping) return
    const params = {
      changes: changes.map((change) => ({
        uri: pathToFileURL(change.path).href,
        type: change.type
      }))
    }
    void write(session.writer, { method: 'workspace/didChangeWatchedFiles', params }).catch(
      () => undefined
    )
  }

  private stop(session: Session): Promise<void> {
    session.stopping ??= (async () => {
      const { child, writer } = session
      if (child.exitCode === null && child.signalCode === null) {
        const sent = Promise.all([
          write(writer, { id: MAIN_REQUEST_ID, method: 'shutdown' }),
          write(writer, { method: 'exit' })
        ]).catch(() => undefined)
        let timer: NodeJS.Timeout | undefined
        const graceOver = new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), STOP_GRACE_MS)
        })
        const result = await Promise.race([sent.then(() => session.exited), graceOver])
        clearTimeout(timer)
        if (result === 'timeout') child.kill('SIGKILL')
      }
      await session.exited
    })()
    return session.stopping
  }

  private closed(session: Session, code: number | null, signal: NodeJS.Signals | null): void {
    const { connection, owner } = session
    session.watcher.close()
    this.sessions.delete(connection.id)
    if (this.byKey.get(key(owner, connection.server, connection.root)) === session) {
      this.byKey.delete(key(owner, connection.server, connection.root))
    }
    if (session.failure !== null) {
      this.status(session, 'failed', [session.failure, ...session.log].join('\n'))
      return
    }
    // A clean exit is the page's own client shutting it down.
    if (session.stopping || code === 0) {
      this.status(session, 'stopped')
      return
    }
    const how = signal ? `was killed (${signal})` : `exited with code ${String(code)}`
    this.status(
      session,
      'failed',
      [`The ${connection.server} language server ${how}.`, ...session.log].join('\n')
    )
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
