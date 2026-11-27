import { client, type ClientContext, ndJsonStream } from '@agentclientprotocol/sdk/unstable'
import { type ChildProcess, spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import type { ChatAgentCommand } from './chat-agent-launch'

/** Lines of the agent's stderr kept to explain a failed start or crash. */
const STDERR_LINES = 20

type ClientBuilder = ReturnType<typeof client>

/** An ACP agent's process and the client's connection to it over stdio. */
export type AcpAgentProcess = {
  child: ChildProcess
  agent: ClientContext
  /** Aborts when the connection closes. */
  connectionLost: AbortSignal
  /** The last lines it printed to stderr, to explain a failure. */
  stderr: string[]
}

/** Starts the agent and connects to it; `handle` adds the client's request and notification handlers. */
export function startAcpAgent(
  command: ChatAgentCommand,
  cwd: string,
  handle: (builder: ClientBuilder) => ClientBuilder
): AcpAgentProcess {
  const child = spawn(command.file, command.args, {
    cwd,
    env: command.env,
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const stderr: string[] = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr.push(...chunk.split('\n').filter(Boolean))
    stderr.splice(0, Math.max(0, stderr.length - STDERR_LINES))
  })
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
  )
  const connection = handle(client({ name: 'hatfield-360' })).connect(stream)
  return { child, agent: connection.agent, connectionLost: connection.signal, stderr }
}
