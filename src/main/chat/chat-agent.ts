import {
  client,
  type ClientContext,
  McpOverAcpProvider,
  ndJsonStream,
  type RequestPermissionResponse,
  type SessionConfigOption
} from '@agentclientprotocol/sdk/unstable'
import {
  fromMcpServer,
  type McpServerAdapter
} from '@agentclientprotocol/sdk/experimental/mcp-server'
import { McpServer } from '@modelcontextprotocol/server'
import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import * as z from 'zod'
import {
  type ChatConfigId,
  type ChatConfigOption,
  type ChatEvent,
  type ChatEventBody,
  type ChatStopReason
} from '../../shared/chat-agent-api'
import type { ChatAgentCommand } from './chat-agent-launch'
import { chatConfigOptions, chatEventsFor, permissionOptions } from './chat-session-updates'
import {
  MAP_PROMPT,
  newSessionRequest,
  PLAYBOOK_TOOL,
  PLAYBOOK_TOOL_DESCRIPTION
} from './chat-session-options'
import type { WorkspaceMapFile } from './workspace-map-file'

/** Lines of the agent's stderr kept to explain a failed start or crash. */
const STDERR_LINES = 20

/** What a chat needs from the rest of the app, given when it starts. */
export type ChatSetup = {
  /** Finds Claude Code and builds the adapter's command; a failure shows in the chat. */
  command: () => Promise<ChatAgentCommand>
  cwd: string
  additionalDirectories: string[]
  mapFile: WorkspaceMapFile
  /** The panel's last model and effort, applied when the agent offers them. */
  preferred: { model: string; effort: string }
}

type PendingPermission = { resolve: (response: RequestPermissionResponse) => void }

const CANCELLED: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } }

const message = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : String(error)

/** One chat: its own adapter process and ACP session, ended with the chat. */
export class ChatAgentSession {
  readonly id = randomUUID()
  private child: ChildProcess | null = null
  private agent: ClientContext | null = null
  /** Aborts when the connection to the agent closes. */
  private connectionLost: AbortSignal | null = null
  private sessionId: string | null = null
  private mapSessionId: string | null = null
  private mapReply = ''
  private configOptions: ChatConfigOption[] = []
  private readonly permissions = new Map<string, PendingPermission>()
  private readonly stderr: string[] = []
  private playbook: McpServerAdapter | null = null
  private ended = false

  constructor(
    private readonly setup: ChatSetup,
    private readonly emit: (event: ChatEvent) => void,
    private readonly onChosen: (configId: ChatConfigId, value: string) => void
  ) {}

  /** Starts the agent and the session; failures are reported as chat events, never thrown. */
  async open(): Promise<void> {
    try {
      const command = await this.setup.command()
      if (this.ended) return
      const agent = this.spawn(command)
      await agent.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'hatfield-360', version: '1' }
      })
      const provider = this.provider
      const registration = provider.registerServer(agent, {
        name: 'hatfield',
        handler: this.playbookServer().handler
      })
      const instructions = await this.setup.mapFile.instructions()
      const session = await agent.request(
        'session/new',
        newSessionRequest({
          cwd: this.setup.cwd,
          additionalDirectories: this.setup.additionalDirectories,
          instructions,
          mcpServers: [registration.declaration],
          purpose: 'chat'
        })
      )
      if (this.ended) return
      this.sessionId = session.sessionId
      this.configOptions = chatConfigOptions(session.configOptions)
      await this.applyDefaults()
      this.send({ kind: 'ready', configOptions: this.configOptions })
    } catch (error) {
      if (this.connectionLost?.aborted) await this.exited()
      this.fail(error)
    }
  }

  prompt(text: string): void {
    const { agent, sessionId } = this.ready()
    void agent.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }).then(
      (response) => this.send({ kind: 'turn-end', stopReason: response.stopReason }),
      (error: unknown) => this.turnFailed(error)
    )
  }

  answerPermission(requestId: string, optionId: string | null): void {
    const pending = this.permissions.get(requestId)
    if (!pending) return
    this.permissions.delete(requestId)
    pending.resolve(optionId === null ? CANCELLED : { outcome: { outcome: 'selected', optionId } })
    this.send({ kind: 'permission-settled', requestId })
  }

  async setConfig(configId: ChatConfigId, value: string): Promise<void> {
    const { agent, sessionId } = this.ready()
    const option = this.configOptions.find((each) => each.id === configId)
    if (!option?.options.some((choice) => choice.value === value))
      throw new Error(`The agent doesn't offer ${value} for ${configId}.`)
    const response = await agent.request('session/set_config_option', {
      sessionId,
      configId,
      value
    })
    this.updateConfig(response.configOptions)
    if (configId !== 'mode') this.onChosen(configId, value)
  }

  /** Cancels the running turn (the chat's or the map's); pending permission requests end cancelled. */
  stop(): void {
    const { agent } = this.ready()
    for (const id of [this.sessionId, this.mapSessionId]) {
      if (id) void agent.notify('session/cancel', { sessionId: id })
    }
    for (const requestId of Array.from(this.permissions.keys()))
      this.answerPermission(requestId, null)
  }

  /** Runs the map turn in a separate read-only session, shown in this chat, and writes its block. */
  generateMap(): void {
    const { agent } = this.ready()
    void (async () => {
      const session = await agent.request(
        'session/new',
        newSessionRequest({
          cwd: this.setup.cwd,
          additionalDirectories: this.setup.additionalDirectories,
          instructions: '',
          mcpServers: [],
          purpose: 'map'
        })
      )
      this.mapSessionId = session.sessionId
      this.mapReply = ''
      const model = this.configOptions.find((option) => option.id === 'model')?.currentValue
      if (model) {
        await agent.request('session/set_config_option', {
          sessionId: session.sessionId,
          configId: 'model',
          value: model
        })
      }
      const response = await agent.request('session/prompt', {
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text: MAP_PROMPT }]
      })
      this.mapSessionId = null
      if (response.stopReason === 'end_turn' && this.mapReply.trim()) {
        const file = await this.setup.mapFile.writeMap(this.mapReply)
        this.send({ kind: 'map-written', file })
      }
      this.send({ kind: 'turn-end', stopReason: response.stopReason })
      await agent.request('session/close', { sessionId: session.sessionId }).catch(() => undefined)
    })().catch((error: unknown) => {
      this.mapSessionId = null
      this.turnFailed(error)
    })
  }

  /** Ends the chat and its agent process. */
  end(): void {
    if (this.ended) return
    this.ended = true
    for (const pending of this.permissions.values()) pending.resolve(CANCELLED)
    this.permissions.clear()
    void this.playbook?.close()
    this.child?.kill()
    this.emit({ chatId: this.id, kind: 'ended' })
  }

  /** Settles once the agent process has exited, or at once when it never started. */
  exited(): Promise<void> {
    const child = this.child
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
    return new Promise((resolve) => child.once('exit', () => resolve()))
  }

  private readonly provider = new McpOverAcpProvider()

  private spawn(command: ChatAgentCommand): ClientContext {
    const child = spawn(command.file, command.args, {
      cwd: this.setup.cwd,
      env: command.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child = child
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.stderr.push(...chunk.split('\n').filter(Boolean))
      this.stderr.splice(0, Math.max(0, this.stderr.length - STDERR_LINES))
    })
    child.on('error', (error) => this.fail(error))
    child.on('exit', (code, signal) => {
      if (this.ended) return
      this.fail(new Error(`The agent exited (${signal ?? `code ${code ?? '?'}`}).`))
    })
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
    )
    const app = client({ name: 'hatfield-360' })
      .onRequest('mcp/message', this.provider.handleRequest)
      .onNotification('session/update', ({ params }) => {
        if (
          params.sessionId === this.mapSessionId &&
          params.update.sessionUpdate === 'agent_message_chunk' &&
          params.update.content.type === 'text'
        )
          this.mapReply += params.update.content.text
        if (params.sessionId !== this.sessionId && params.sessionId !== this.mapSessionId) return
        for (const body of chatEventsFor(params.update)) {
          if (body.kind === 'config') this.configOptions = body.configOptions
          this.send(body)
        }
      })
      .onRequest('session/request_permission', ({ params }) => {
        if (this.ended) return CANCELLED
        const requestId = randomUUID()
        return new Promise<RequestPermissionResponse>((resolve) => {
          this.permissions.set(requestId, { resolve })
          this.send({
            kind: 'permission',
            requestId,
            toolCallId: params.toolCall.toolCallId,
            title: params.toolCall.title ?? 'Permission needed',
            options: permissionOptions(params.options)
          })
        })
      })
    const connection = app.connect(stream)
    this.connectionLost = connection.signal
    this.agent = connection.agent
    return connection.agent
  }

  private playbookServer(): McpServerAdapter {
    const mapFile = this.setup.mapFile
    this.playbook = fromMcpServer(() => {
      const server = new McpServer({ name: 'hatfield', version: '1.0.0' })
      server.registerTool(
        PLAYBOOK_TOOL,
        {
          description: PLAYBOOK_TOOL_DESCRIPTION,
          inputSchema: z.object({ text: z.string().min(1).max(1000) })
        },
        async ({ text }) => {
          const saved = await mapFile.saveToPlaybook(text)
          return saved
            ? { content: [{ type: 'text', text: 'Saved to the playbook.' }] }
            : {
                isError: true,
                content: [
                  {
                    type: 'text',
                    text: 'The playbook is full. Tell the user to remove old entries with Edit map before saving more.'
                  }
                ]
              }
        }
      )
      return server
    })
    return this.playbook
  }

  /** The panel's last model and effort, and auto mode, where the agent offers them. */
  private async applyDefaults(): Promise<void> {
    const wanted: [ChatConfigId, string][] = [
      ['model', this.setup.preferred.model],
      ['effort', this.setup.preferred.effort],
      ['mode', 'auto']
    ]
    const { agent, sessionId } = this.ready()
    for (const [configId, value] of wanted) {
      const option = this.configOptions.find((each) => each.id === configId)
      if (!option || option.currentValue === value) continue
      if (!option.options.some((choice) => choice.value === value)) continue
      const response = await agent.request('session/set_config_option', {
        sessionId,
        configId,
        value
      })
      this.configOptions = chatConfigOptions(response.configOptions)
    }
  }

  private updateConfig(options: SessionConfigOption[]): void {
    this.configOptions = chatConfigOptions(options)
    this.send({ kind: 'config', configOptions: this.configOptions })
  }

  private ready(): { agent: ClientContext; sessionId: string } {
    if (this.ended || !this.agent || !this.sessionId) throw new Error('The chat is not running.')
    return { agent: this.agent, sessionId: this.sessionId }
  }

  private turnFailed(error: unknown): void {
    if (this.ended) return
    // A lost connection means the agent went away: its exit, with what it printed, explains it.
    if (this.connectionLost?.aborted) {
      void this.exited().then(() => this.fail(error))
      return
    }
    this.send({ kind: 'error', message: message(error) })
    this.send({ kind: 'turn-end', stopReason: 'error' satisfies ChatStopReason })
  }

  private fail(error: unknown): void {
    if (this.ended) return
    const detail = this.stderr.length > 0 ? `\n\n${this.stderr.join('\n')}` : ''
    this.send({ kind: 'error', message: `${message(error)}${detail}` })
    this.end()
  }

  private send(body: ChatEventBody): void {
    if (!this.ended) this.emit({ ...body, chatId: this.id })
  }
}
