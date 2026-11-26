import { dirname, isAbsolute, join } from 'node:path'
import type { AgentProfile } from '../../shared/agent-api'
import { findOnShellPath } from '../terminal/shell-lookup'
import { terminalEnvironment } from '../terminal/terminal-environment'

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
  const found = await findOnShellPath(executable, cwd)
  if (found !== null) return found
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
