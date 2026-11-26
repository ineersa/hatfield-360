import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { defaultShell } from './default-shell'
import { terminalEnvironment } from './terminal-environment'

/** A login shell whose startup waits on something gives up, and the program counts as not found. */
const LOOKUP_TIMEOUT_MS = 15_000

/**
 * Where the user's interactive shell finds `executable` from `cwd`, with the PATH its startup files
 * set (as agent and hunk terminals run it); null when it finds nothing.
 */
export async function findOnShellPath(executable: string, cwd: string): Promise<string | null> {
  const shell = defaultShell(process.env, process.platform)
  const fish = basename(shell.file) === 'fish'
  const args = [
    ...shell.args,
    '-ic',
    fish ? 'command -v -- $argv[1]' : 'command -v -- "$1"',
    fish ? '--' : 'hatfield-360',
    executable
  ]
  return lookedUpPath(await lastLineOf(shell.file, args, cwd))
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
