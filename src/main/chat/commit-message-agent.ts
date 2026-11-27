import {
  McpOverAcpProvider,
  type RequestPermissionResponse
} from '@agentclientprotocol/sdk/unstable'
import { fromMcpServer } from '@agentclientprotocol/sdk/experimental/mcp-server'
import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'
import type { ChatConfigId } from '../../shared/chat-agent-api'
import { isPlainObject } from '../../shared/plain-object'
import { type AcpAgentProcess, startAcpAgent } from './acp-agent-process'
import type { ChatAgentCommand } from './chat-agent-launch'
import { newSessionRequest } from './chat-session-options'
import { chatConfigOptions } from './chat-session-updates'

const FILE_DIFF_TOOL = 'file_diff'
const MCP_SERVER = 'hatfield'
/** How Claude Code names the app's tool in a tool call. */
const FILE_DIFF_CALL = `mcp__${MCP_SERVER}__${FILE_DIFF_TOOL}`

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

const STOPPED: CommitMessageReply = { stopReason: 'cancelled', text: '' }

/** What a step resolves to once the user has stopped the message. */
const STOP = Symbol('stop')

const message = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : String(error)

/** The tool a call is for, as Claude Code names it in the call's `_meta`. */
function toolName({ _meta: meta }: { _meta?: Record<string, unknown> | null }): unknown {
  const claudeCode = meta?.claudeCode
  return isPlainObject(claudeCode) ? claudeCode.toolName : undefined
}

/** Rejects once the process has exited, with what it printed. */
function exitOf(process: AcpAgentProcess): Promise<never> {
  const exited = new Promise<never>((_resolve, reject) => {
    const failed = (error: Error): void => {
      const detail = process.stderr.length > 0 ? `\n\n${process.stderr.join('\n')}` : ''
      reject(new Error(`${error.message}${detail}`))
    }
    process.child.once('error', failed)
    process.child.once('exit', (code, signal) =>
      failed(new Error(`The agent exited (${signal ?? `code ${code ?? '?'}`}).`))
    )
  })
  exited.catch(() => undefined)
  return exited
}

/** The app's one tool for the agent: a file's diff, served by `diff`. */
function diffServer(diff: (path: string) => Promise<string>): ReturnType<typeof fromMcpServer> {
  return fromMcpServer(() => {
    const server = new McpServer({ name: MCP_SERVER, version: '1.0.0' })
    server.registerTool(
      FILE_DIFF_TOOL,
      {
        description: FILE_DIFF_DESCRIPTION,
        inputSchema: z.object({ path: z.string().min(1).max(4096) })
      },
      async ({ path }) => {
        try {
          return { content: [{ type: 'text', text: (await diff(path)) || 'No changes.' }] }
        } catch (error) {
          return { isError: true, content: [{ type: 'text', text: message(error) }] }
        }
      }
    )
    return server
  })
}

/**
 * Starts the agent, has it write one commit message and stops it: nothing runs between messages.
 * Cancelling `signal` returns at once, `cancelled`, without waiting for the agent.
 */
export async function writeCommitMessage(
  { command, cwd }: { command: ChatAgentCommand; cwd: string },
  turn: CommitMessageTurn,
  signal: AbortSignal
): Promise<CommitMessageReply> {
  if (signal.aborted) return STOPPED
  const provider = new McpOverAcpProvider()
  let sessionId: string | null = null
  let text = ''
  const process = startAcpAgent(command, cwd, (app) =>
    app
      .onRequest('mcp/message', provider.handleRequest)
      .onNotification('session/update', ({ params }) => {
        const { update } = params
        if (
          params.sessionId === sessionId &&
          update.sessionUpdate === 'agent_message_chunk' &&
          update.content.type === 'text'
        )
          text += update.content.text
      })
      // Only the app's own diff tool exists in the session: it may run, nothing else.
      .onRequest('session/request_permission', ({ params }) => {
        if (params.sessionId !== sessionId) return CANCELLED
        if (toolName(params.toolCall) !== FILE_DIFF_CALL) return CANCELLED
        const allow = params.options.find((option) => option.kind === 'allow_once')
        return allow ? { outcome: { outcome: 'selected', optionId: allow.optionId } } : CANCELLED
      })
  )
  const { agent } = process
  const exited = exitOf(process)
  const stop = new Promise<typeof STOP>((resolve) =>
    signal.addEventListener('abort', () => resolve(STOP), { once: true })
  )
  /** The request's outcome, or the agent's exit when it went away under it; a stop wins over both. */
  const step = async <T>(request: Promise<T>): Promise<T | typeof STOP> => {
    try {
      return await Promise.race([request, exited, stop])
    } catch (error) {
      if (process.connectionLost.aborted) await Promise.race([exited, stop])
      throw error
    }
  }
  try {
    const initialized = await step(
      agent.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'hatfield-360', version: '1' }
      })
    )
    if (initialized === STOP) return STOPPED
    const { declaration } = provider.registerServer(agent, {
      name: MCP_SERVER,
      handler: diffServer(turn.diff).handler
    })
    const session = await step(
      agent.request(
        'session/new',
        newSessionRequest({
          cwd,
          additionalDirectories: [],
          instructions: '',
          mcpServers: [declaration],
          purpose: 'commit-message'
        })
      )
    )
    if (session === STOP) return STOPPED
    let options = chatConfigOptions(session.configOptions)
    const wanted: [ChatConfigId, string][] = [
      ['model', turn.model],
      ['effort', turn.effort]
    ]
    for (const [configId, value] of wanted) {
      const option = options.find((each) => each.id === configId)
      if (!option || option.currentValue === value) continue
      // A value the agent doesn't offer leaves its own default.
      if (!option.options.some((choice) => choice.value === value)) continue
      const response = await step(
        agent.request('session/set_config_option', {
          sessionId: session.sessionId,
          configId,
          value
        })
      )
      if (response === STOP) return STOPPED
      options = chatConfigOptions(response.configOptions)
    }
    sessionId = session.sessionId
    const response = await step(
      agent.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: turn.prompt }]
      })
    )
    return response === STOP ? STOPPED : { stopReason: response.stopReason, text }
  } finally {
    process.child.kill()
  }
}
