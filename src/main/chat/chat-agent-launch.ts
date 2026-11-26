import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { AgentProfile } from '../../shared/agent-api'
import { defaultShell } from '../terminal/default-shell'
import { terminalEnvironment } from '../terminal/terminal-environment'

/** A login shell whose startup waits on something gives up, and the chat says Claude wasn't found. */
const LOOKUP_TIMEOUT_MS = 15_000

/** API keys would switch the chat to API billing; only the `claude` binary's own login is used. */
const BILLING_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const

/**
 * Replaces the ACP adapter with another Node script speaking ACP on stdio; the E2E tests point it at
 * the cassette replayer. Read from main's own environment only.
 */
const AGENT_SCRIPT_OVERRIDE = 'HATFIELD_CHAT_AGENT_SCRIPT'

export type ChatAgentCommand = { file: string; args: string[]; env: Record<string, string> }

/** Another agent stands in for the adapter, so no Claude Code is looked up. */
export const agentScriptOverridden = (): boolean => Boolean(process.env[AGENT_SCRIPT_OVERRIDE])

/** The adapter's entry script, which runs on Electron's own Node. */
function adapterScript(): string {
  const override = process.env[AGENT_SCRIPT_OVERRIDE]
  if (override) return override
  return join(
    dirname(require.resolve('@agentclientprotocol/claude-agent-acp/package.json')),
    'dist',
    'index.js'
  )
}

/**
 * The profile's executable as the user's interactive shell finds it, as Launch Claude runs it; an
 * absolute path is used as it is.
 */
export async function resolveClaude(profile: AgentProfile, cwd: string): Promise<string> {
  const { executable } = profile
  if (isAbsolute(executable)) return executable
  if (/[\\/]/.test(executable)) return join(cwd, executable)
  const shell = defaultShell(process.env, process.platform)
  const script = basename(shell.file) === 'fish' ? 'command -v -- $argv[1]' : 'command -v -- "$1"'
  const args = [
    ...shell.args,
    '-ic',
    script,
    ...(basename(shell.file) === 'fish' ? ['--'] : ['hatfield-360']),
    executable
  ]
  const found = lookedUpPath(await lastLineOf(shell.file, args, cwd))
  if (found !== null) return found
  throw new Error(
    `Claude Code ("${executable}") wasn't found on your shell's PATH. Install it, or set its path in Settings → Agent launch profiles.`
  )
}

/**
 * The executable a `command -v` line names: a path, or an alias's command (Claude's local install
 * adds `alias claude=~/.claude/local/claude`).
 */
export function lookedUpPath(line: string | null): string | null {
  const alias = line?.match(/^(?:alias\s+)?[^\s=/]+=(?<value>.+)$/)?.groups?.['value']
  const command = alias === undefined ? line : alias.replace(/^(['"])(.*)\1$/, '$2').split(/\s+/)[0]
  if (!command) return null
  const path = command.startsWith('~/') ? join(homedir(), command.slice(2)) : command
  return isAbsolute(path) ? path : null
}

/**
 * The last line a shell lookup prints (startup files may print first), or null when it fails. Its
 * stdin is closed, so a startup prompt gets EOF, and it's killed outright: an interactive shell
 * ignores SIGTERM.
 */
function lastLineOf(file: string, args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: terminalEnvironment(process.env, { platform: process.platform, appVersion: '' })
    })
    let stdout = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    const timer = setTimeout(() => child.kill('SIGKILL'), LOOKUP_TIMEOUT_MS)
    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? (stdout.trim().split('\n').at(-1)?.trim() ?? null) : null)
    })
  })
}

/** The adapter run on Electron's Node, with the given Claude Code and without API keys. */
export function chatAgentCommand(claude: string, appVersion: string): ChatAgentCommand {
  const env = terminalEnvironment(process.env, { platform: process.platform, appVersion })
  for (const key of BILLING_KEYS) delete env[key]
  env.ELECTRON_RUN_AS_NODE = '1'
  env.CLAUDE_CODE_EXECUTABLE = claude
  return { file: process.execPath, args: [adapterScript()], env }
}
