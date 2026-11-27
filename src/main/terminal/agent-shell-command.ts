import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import type { AgentProfile } from '../../shared/agent-api'
import { defaultShell, type ShellCommand } from './default-shell'

export class UnsupportedAgentShell extends Error {}

/** `~` or a leading `~/` as the home folder; everything else stays literal, as typed. */
export function expandHome(value: string, home = homedir()): string {
  if (value === '~') return home
  return value.startsWith('~/') ? join(home, value.slice(2)) : value
}

type AgentShellOptions = {
  /**
   * For a protocol on stdio: the caller parks the real stdout on file descriptor 3 and stdin on 4,
   * so startup files print to stderr and read nothing, and the program gets both back.
   */
  quietStartup?: boolean
  /** Variables removed after the startup files ran, which may have exported them. */
  unsetEnv?: readonly string[]
}

/** The profile run through the user's interactive shell from `cwd`, so its startup files set PATH. */
export function agentShellCommand(
  profile: Pick<AgentProfile, 'executable' | 'args'>,
  cwd: string,
  shell = defaultShell(process.env, process.platform),
  { quietStartup = false, unsetEnv = [] }: AgentShellOptions = {}
): ShellCommand {
  const executable = expandHome(profile.executable)
  const args = profile.args.map((arg) => expandHome(arg))
  if (process.platform === 'win32') {
    const file =
      !isAbsolute(executable) && /[\\/]/.test(executable) ? resolve(cwd, executable) : executable
    return { file, args }
  }
  const restore = quietStartup ? ' 1>&3 3>&- 0<&4 4<&-' : ''
  switch (basename(shell.file)) {
    case 'bash':
    case 'zsh':
      return {
        file: shell.file,
        args: [
          ...shell.args,
          '-ic',
          `${unsetEnv.map((name) => `unset ${name}; `).join('')}cd -- "$1" && shift && exec -- "$@"${restore}`,
          'hatfield-360',
          cwd,
          executable,
          ...args
        ]
      }
    case 'fish':
      return {
        file: shell.file,
        args: [
          ...shell.args,
          '-ic',
          `${unsetEnv.map((name) => `set -e ${name}; `).join('')}cd -- $argv[1]; and exec -- $argv[2..-1]${restore}`,
          '--',
          cwd,
          executable,
          ...args
        ]
      }
    default:
      throw new UnsupportedAgentShell(
        'Agent profiles require Bash, Zsh or Fish as your default shell.'
      )
  }
}
