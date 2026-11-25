import { execFile } from 'node:child_process'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
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
  try {
    const { stdout } = await promisify(execFile)(shell.file, args, {
      cwd,
      timeout: LOOKUP_TIMEOUT_MS,
      env: terminalEnvironment(process.env, { platform: process.platform, appVersion: '' })
    })
    // Interactive startup files may print first; the path is the last line.
    const found = stdout.trim().split('\n').at(-1)?.trim()
    if (found && isAbsolute(found)) return found
  } catch {
    // Not found, or the shell failed: reported below.
  }
  throw new Error(
    `Claude Code ("${executable}") wasn't found on your shell's PATH. Install it, or set its path in Settings → Agent launch profiles.`
  )
}

/** The adapter run on Electron's Node, with the given Claude Code and without API keys. */
export function chatAgentCommand(claude: string, appVersion: string): ChatAgentCommand {
  const env = terminalEnvironment(process.env, { platform: process.platform, appVersion })
  for (const key of BILLING_KEYS) delete env[key]
  env.ELECTRON_RUN_AS_NODE = '1'
  env.CLAUDE_CODE_EXECUTABLE = claude
  return { file: process.execPath, args: [adapterScript()], env }
}
