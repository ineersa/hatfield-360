// Ported from Orca (MIT, see THIRD_PARTY_NOTICES.md): local-pty-executable-spawn.ts (Unix shell
// validation and fallbacks) and shell-launch/windows/powershell-executable.ts (PowerShell lookup).
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { isAbsolute, win32 } from 'node:path'

const UNIX_SHELL_FALLBACKS = ['/bin/zsh', '/bin/bash', '/bin/sh'] as const

export type ShellCommand = { file: string; args: string[] }

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function readEnv(env: NodeJS.ProcessEnv, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name]
    if (value) return value
  }
  return undefined
}

/** `$SHELL` if it can run, else the first of zsh, bash and sh that can. */
function unixShell(env: NodeJS.ProcessEnv): string {
  const preferred = env.SHELL && isAbsolute(env.SHELL) ? [env.SHELL] : []
  const candidates = [...preferred, ...UNIX_SHELL_FALLBACKS.filter((path) => path !== env.SHELL)]
  const found = candidates.find(isExecutable)
  if (!found) throw new Error(`No shell found (tried ${candidates.join(', ')}).`)
  return found
}

/** Store "App Execution Alias" stubs launch from a command line but fail under ConPTY, so they don't count. */
function isRealWindowsExecutable(path: string): boolean {
  if (/[\\/]Microsoft[\\/]WindowsApps[\\/]/i.test(path)) return false
  try {
    const stat = statSync(path)
    return stat.isFile() && stat.size > 0
  } catch {
    return false
  }
}

/** PowerShell 7 installs, newest layout first, then any `pwsh.exe` on an absolute PATH entry. */
function pwshCandidates(env: NodeJS.ProcessEnv): string[] {
  const candidates: string[] = []
  const add = (path: string): void => {
    const normalized = win32.normalize(path)
    if (!candidates.some((seen) => seen.toLowerCase() === normalized.toLowerCase())) {
      candidates.push(normalized)
    }
  }
  const programFiles = [
    readEnv(env, ['ProgramW6432', 'PROGRAMW6432']),
    readEnv(env, ['ProgramFiles', 'PROGRAMFILES']),
    readEnv(env, ['ProgramFiles(x86)', 'PROGRAMFILES(X86)'])
  ]
  for (const root of programFiles) {
    if (!root) continue
    for (const major of ['7', '8', '6']) add(win32.join(root, 'PowerShell', major, 'pwsh.exe'))
  }
  const localAppData = readEnv(env, ['LOCALAPPDATA', 'LocalAppData'])
  if (localAppData) {
    for (const major of ['7', '8', '6']) {
      add(win32.join(localAppData, 'Microsoft', 'PowerShell', major, 'pwsh.exe'))
    }
  }
  for (const dir of (readEnv(env, ['PATH', 'Path', 'path']) ?? '').split(win32.delimiter)) {
    const trimmed = dir.trim().replace(/^"|"$/g, '')
    // A relative PATH entry would let a repository plant its own pwsh.exe.
    if (win32.isAbsolute(trimmed)) add(win32.join(trimmed, 'pwsh.exe'))
  }
  return candidates
}

function windowsShell(env: NodeJS.ProcessEnv): ShellCommand {
  const pwsh = pwshCandidates(env).find(isRealWindowsExecutable)
  if (pwsh) return { file: pwsh, args: ['-NoLogo'] }
  const systemRoot = readEnv(env, ['SystemRoot', 'WINDIR', 'windir']) ?? 'C:\\Windows'
  const powershell = win32.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  if (existsSync(powershell)) return { file: powershell, args: ['-NoLogo'] }
  return { file: readEnv(env, ['ComSpec', 'COMSPEC']) ?? 'cmd.exe', args: [] }
}

/**
 * The user's shell: `$SHELL` on macOS and Linux (a login shell on macOS, like Terminal.app),
 * PowerShell 7, then Windows PowerShell, then `COMSPEC` on Windows.
 */
export function defaultShell(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): ShellCommand {
  if (platform === 'win32') return windowsShell(env)
  return { file: unixShell(env), args: platform === 'darwin' ? ['-l'] : [] }
}
