import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type { AgentProfile } from '../../shared/agent-api'
import { agentShellCommand, expandHome } from '../terminal/agent-shell-command'
import type { ShellCommand } from '../terminal/default-shell'
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
const agentScriptOverridden = (): boolean => Boolean(process.env[AGENT_SCRIPT_OVERRIDE])

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
export async function resolveClaude(
  profile: Pick<AgentProfile, 'executable'>,
  cwd: string
): Promise<string> {
  const executable = expandHome(profile.executable)
  if (isAbsolute(executable)) return executable
  if (/[\\/]/.test(executable)) return join(cwd, executable)
  const found = await findOnShellPath(executable, cwd)
  if (found !== null) return found
  throw new Error(
    `Claude Code ("${executable}") wasn't found on your shell's PATH. Install it, or set its path in Settings → Agent launch profiles.`
  )
}

const quoted = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`

/** Stands in for the session folder while the command is built; no profile value contains NUL. */
const SESSION_FOLDER = '\0session-folder'
const SHIM_NAME = /^claude-[0-9a-f]{16}$/
/** Older shims belong to earlier profiles; one this old is not behind a running chat any more. */
const STALE_SHIM_MS = 7 * 24 * 60 * 60 * 1000

/** Removes other profiles' shims left untouched for a week; best effort. */
async function removeStaleShims(directory: string, current: string): Promise<void> {
  const cutoff = Date.now() - STALE_SHIM_MS
  for (const name of await readdir(directory).catch(() => [])) {
    if (name === current || !SHIM_NAME.test(name)) continue
    const path = join(directory, name)
    const found = await stat(path).catch(() => null)
    if (found && found.mtimeMs < cutoff) await rm(path, { force: true }).catch(() => undefined)
  }
}

/**
 * A script that runs the whole profile (wrapper and arguments) through the user's shell, as an agent
 * terminal does, with the adapter's arguments after the profile's. Named by its content, so
 * concurrent writers of one profile write the same file and a changed profile gets a new one.
 */
export async function writeClaudeShim(
  profile: Pick<AgentProfile, 'executable' | 'args'>,
  directory: string,
  shell?: ShellCommand
): Promise<string> {
  const command = agentShellCommand(profile, SESSION_FOLDER, shell, {
    quietStartup: true,
    // Startup files may export an API key, which would bill the API.
    unsetEnv: BILLING_KEYS
  })
  const words = [command.file, ...command.args].map((word) =>
    // The folder the adapter started the shim in, fixed before startup files can cd elsewhere.
    word === SESSION_FOLDER ? '"$PWD"' : quoted(word)
  )
  const script = [
    '#!/bin/sh',
    // Startup files must neither print to stdout nor read stdin: both carry the agent protocol.
    'exec 3>&1 4<&0 1>&2 0</dev/null',
    `exec ${words.join(' ')} "$@"`,
    ''
  ].join('\n')
  const name = `claude-${createHash('sha256').update(script).digest('hex').slice(0, 16)}`
  const path = join(directory, name)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, script, { mode: 0o700 })
  await rename(temporary, path)
  await removeStaleShims(directory, name)
  return path
}

/** The adapter run on Electron's Node, with the given Claude Code and without API keys. */
export function chatAgentCommand(
  claude: string,
  appVersion: string,
  profileEnv: Record<string, string> = {}
): ChatAgentCommand {
  const env = {
    ...terminalEnvironment(process.env, { platform: process.platform, appVersion }),
    ...profileEnv
  }
  for (const key of BILLING_KEYS) delete env[key]
  env.ELECTRON_RUN_AS_NODE = '1'
  env.CLAUDE_CODE_EXECUTABLE = claude
  return { file: process.execPath, args: [adapterScript()], env }
}

/**
 * The adapter for the Claude launch profile: its executable directly, or a shim when the profile
 * wraps Claude Code in another program or passes it arguments.
 */
export async function claudeAgentCommand(
  profile: AgentProfile,
  cwd: string,
  appVersion: string,
  /** The app's data folder; shims go in its private `agent-shims` folder. */
  userData: string
): Promise<ChatAgentCommand> {
  const claude = agentScriptOverridden()
    ? 'claude'
    : profile.args.length && process.platform !== 'win32'
      ? await writeClaudeShim(profile, join(userData, 'agent-shims'))
      : await resolveClaude(profile, cwd)
  return chatAgentCommand(claude, appVersion, profile.env)
}
