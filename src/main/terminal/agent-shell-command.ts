import { basename, isAbsolute, resolve } from 'node:path'
import type { AgentProfile } from '../../shared/agent-api'
import { defaultShell, type ShellCommand } from './default-shell'

export class UnsupportedAgentShell extends Error {}

export function agentShellCommand(profile: AgentProfile, cwd: string): ShellCommand {
  const { executable, args } = profile
  if (process.platform === 'win32') {
    const file =
      !isAbsolute(executable) && /[\\/]/.test(executable) ? resolve(cwd, executable) : executable
    return { file, args }
  }
  const shell = defaultShell(process.env, process.platform)
  switch (basename(shell.file)) {
    case 'bash':
    case 'zsh':
      return {
        file: shell.file,
        args: [
          ...shell.args,
          '-ic',
          'cd -- "$1" && shift && exec -- "$@"',
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
          'cd -- $argv[1]; and exec -- $argv[2..-1]',
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
