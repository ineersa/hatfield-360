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

/**
 * The profile run through the user's interactive shell from `cwd`, so its startup files set PATH.
 * With `quietStartup`, what the startup files print goes to stderr and only the program writes to
 * stdout (file descriptor 3 carries the real stdout past the startup), for a protocol on stdio.
 */
export function agentShellCommand(
  profile: Pick<AgentProfile, 'executable' | 'args'>,
  cwd: string,
  shell = defaultShell(process.env, process.platform),
  { quietStartup = false } = {}
): ShellCommand {
  const executable = expandHome(profile.executable)
  const args = profile.args.map((arg) => expandHome(arg))
  if (process.platform === 'win32') {
    const file =
      !isAbsolute(executable) && /[\\/]/.test(executable) ? resolve(cwd, executable) : executable
    return { file, args }
  }
  const restore = quietStartup ? ' 1>&3 3>&-' : ''
  switch (basename(shell.file)) {
    case 'bash':
    case 'zsh':
      return {
        file: shell.file,
        args: [
          ...shell.args,
          '-ic',
          `cd -- "$1" && shift && exec -- "$@"${restore}`,
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
          `cd -- $argv[1]; and exec -- $argv[2..-1]${restore}`,
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
