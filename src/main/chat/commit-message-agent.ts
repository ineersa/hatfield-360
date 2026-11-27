import {
  type ClientContext,
  type McpServer as AcpMcpServer,
  McpOverAcpProvider,
  type RequestPermissionResponse
} from '@agentclientprotocol/sdk/unstable'
import { fromMcpServer } from '@agentclientprotocol/sdk/experimental/mcp-server'
import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import type { ChatConfigId } from '../../shared/chat-agent-api'
import { type AcpAgentProcess, startAcpAgent } from './acp-agent-process'
import type { ChatAgentCommand } from './chat-agent-launch'
import { newSessionRequest } from './chat-session-options'
import { chatConfigOptions } from './chat-session-updates'

const FILE_DIFF_TOOL = 'file_diff'

const FILE_DIFF_DESCRIPTION =
  "The diff of one file of the commit, cut when long. Only for a file whose name and line counts don't say what changed."

const CANCELLED: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } }

/** What one message takes: the prompt, the settings it runs on, and the diff of a file it may ask for. */
export type CommitMessageTurn = {
  prompt: string
  model: string
  effort: string
  diff: (path: string) => Promise<string>
}

/** How the agent ended the turn, and the text it answered with. */
export type CommitMessageReply = { stopReason: string; text: string }

type Running = {
  process: AcpAgentProcess
  agent: ClientContext
  server: AcpMcpServer
  /** The folder sessions start in: they read no files, so any will do. */
  cwd: string
  /** Rejects once the process has exited, with what it printed. */
  exited: Promise<never>
}

/** A session made ahead of the next message, on the settings it was made for. */
type Session = { sessionId: string; model: string; effort: string }

const message = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : String(error)

/**
 * `request`'s outcome; when the agent went away under it, its exit, with what it printed, is the
 * error instead of the closed connection.
 */
async function explained<T>(
  running: Pick<Running, 'process' | 'exited'>,
  request: Promise<T>
): Promise<T> {
  try {
    return await Promise.race([request, running.exited])
  } catch (error) {
    if (running.process.connectionLost.aborted) await running.exited
    throw error
  }
}

/**
 * The agent that writes commit messages. Its process stays up between messages and the next
 * message's session is made as soon as the last one ends, so a message costs one model turn.
 */
export class CommitMessageAgent {
  private running: Promise<Running> | null = null
  private spare: Promise<Session> | null = null
  private turn: {
    sessionId: string
    text: string
    diff: (path: string) => Promise<string>
  } | null = null
  private readonly provider = new McpOverAcpProvider()
  private ended = false

  constructor(
    private readonly command: () => Promise<{ command: ChatAgentCommand; cwd: string }>
  ) {}

  /** Starts the process and a session on these settings, unless they are ready already. */
  warm(model: string, effort: string): Promise<void> {
    if (this.spare === null) this.prepare(model, effort)
    return (this.spare ?? Promise.resolve()).then(() => undefined)
  }

  /** Runs one message's turn; cancelling `signal` cancels the turn, which then ends `cancelled`. */
  async write(turn: CommitMessageTurn, signal: AbortSignal): Promise<CommitMessageReply> {
    const running = await this.start()
    const { agent } = running
    const spare = await this.takeSpare()
    const session =
      spare !== null && spare.model === turn.model && spare.effort === turn.effort
        ? spare
        : await this.newSession(turn.model, turn.effort)
    if (spare !== null && spare !== session) this.close(agent, spare.sessionId)
    const { sessionId } = session
    this.turn = { sessionId, text: '', diff: turn.diff }
    // A stop returns at once: the agent's own end of the turn, whenever it comes, is not waited for.
    const stop = new Promise<{ stopReason: 'cancelled' }>((resolve) =>
      signal.addEventListener('abort', () => resolve({ stopReason: 'cancelled' }), { once: true })
    )
    const cancel = (): void => void agent.notify('session/cancel', { sessionId })
    signal.addEventListener('abort', cancel, { once: true })
    let failed = false
    try {
      if (signal.aborted) return { stopReason: 'cancelled', text: '' }
      const response = await Promise.race([
        explained(
          running,
          agent.request('session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text: turn.prompt }]
          })
        ),
        stop
      ])
      return { stopReason: response.stopReason, text: this.turn.text }
    } catch (error) {
      failed = true
      throw error
    } finally {
      signal.removeEventListener('abort', cancel)
      this.turn = null
      this.close(agent, sessionId)
      // A failed agent isn't started again until the next message asks for it.
      if (!this.ended && !failed) this.prepare(turn.model, turn.effort)
    }
  }

  /** Stops the process; the next warm or write starts another. */
  end(): void {
    this.ended = true
    void this.running?.then(({ process }) => process.child.kill()).catch(() => undefined)
    this.running = null
    this.spare = null
  }

  private prepare(model: string, effort: string): void {
    const spare = this.newSession(model, effort)
    this.spare = spare
    // A failed one is made again by the next write, which then reports why.
    spare.catch(() => {
      if (this.spare === spare) this.spare = null
    })
  }

  private async takeSpare(): Promise<Session | null> {
    const spare = this.spare
    this.spare = null
    return spare === null ? null : spare.catch(() => null)
  }

  private async newSession(model: string, effort: string): Promise<Session> {
    const running = await this.start()
    const { agent, server, cwd } = running
    const session = await explained(
      running,
      agent.request(
        'session/new',
        newSessionRequest({
          cwd,
          additionalDirectories: [],
          instructions: '',
          mcpServers: [server],
          purpose: 'commit-message'
        })
      )
    )
    let options = chatConfigOptions(session.configOptions)
    const wanted: [ChatConfigId, string][] = [
      ['model', model],
      ['effort', effort]
    ]
    for (const [configId, value] of wanted) {
      const option = options.find((each) => each.id === configId)
      if (!option || option.currentValue === value) continue
      // A value the agent doesn't offer leaves its own default.
      if (!option.options.some((choice) => choice.value === value)) continue
      const response = await explained(
        running,
        agent.request('session/set_config_option', {
          sessionId: session.sessionId,
          configId,
          value
        })
      )
      options = chatConfigOptions(response.configOptions)
    }
    return { sessionId: session.sessionId, model, effort }
  }

  private close(agent: ClientContext, sessionId: string): void {
    void agent.request('session/close', { sessionId }).catch(() => undefined)
  }

  private start(): Promise<Running> {
    this.ended = false
    if (this.running === null) {
      const running = this.launch()
      this.running = running
      running.catch(() => {
        if (this.running === running) this.running = null
      })
    }
    return this.running
  }

  private async launch(): Promise<Running> {
    const { command, cwd } = await this.command()
    const process = startAcpAgent(command, cwd, (app) =>
      app
        .onRequest('mcp/message', this.provider.handleRequest)
        .onNotification('session/update', ({ params }) => {
          const { update } = params
          if (
            this.turn?.sessionId === params.sessionId &&
            update.sessionUpdate === 'agent_message_chunk' &&
            update.content.type === 'text'
          )
            this.turn.text += update.content.text
        })
        // Only the app's own diff tool exists in these sessions: it may run, nothing else.
        .onRequest('session/request_permission', ({ params }) => {
          if (this.turn?.sessionId !== params.sessionId) return CANCELLED
          if (!JSON.stringify(params.toolCall).includes(FILE_DIFF_TOOL)) return CANCELLED
          const allow = params.options.find((option) => option.kind === 'allow_once')
          return allow ? { outcome: { outcome: 'selected', optionId: allow.optionId } } : CANCELLED
        })
    )
    const exited = new Promise<never>((_resolve, reject) => {
      const failed = (error: Error): void => {
        if (this.running === running) {
          this.running = null
          this.spare = null
        }
        const detail = process.stderr.length > 0 ? `\n\n${process.stderr.join('\n')}` : ''
        reject(new Error(`${error.message}${detail}`))
      }
      process.child.once('error', failed)
      process.child.once('exit', (code, signal) =>
        failed(new Error(`The agent exited (${signal ?? `code ${code ?? '?'}`}).`))
      )
    })
    exited.catch(() => undefined)
    const running = this.running
    await explained(
      { process, exited },
      process.agent.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'hatfield-360', version: '1' }
      })
    )
    const registration = this.provider.registerServer(process.agent, {
      name: 'hatfield',
      handler: this.diffServer().handler
    })
    return { process, agent: process.agent, server: registration.declaration, cwd, exited }
  }

  private diffServer(): ReturnType<typeof fromMcpServer> {
    return fromMcpServer(() => {
      const server = new McpServer({ name: 'hatfield', version: '1.0.0' })
      server.registerTool(
        FILE_DIFF_TOOL,
        {
          description: FILE_DIFF_DESCRIPTION,
          inputSchema: z.object({ path: z.string().min(1).max(4096) })
        },
        async ({ path }) => {
          const turn = this.turn
          if (turn === null)
            return {
              isError: true,
              content: [{ type: 'text', text: 'No message is being written.' }]
            }
          try {
            return { content: [{ type: 'text', text: (await turn.diff(path)) || 'No changes.' }] }
          } catch (error) {
            return { isError: true, content: [{ type: 'text', text: message(error) }] }
          }
        }
      )
      return server
    })
  }
}
