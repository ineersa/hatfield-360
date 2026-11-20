// Ported from Orca (MIT, see THIRD_PARTY_NOTICES.md): local-pty-spawn-environment.ts and the
// shell-startup env scrubbers (appimage-terminal-env, chromium-session-bus-env, build-mode-env, terminal-color-env).
import { delimiter } from 'node:path'

const APPIMAGE_RUNTIME_KEYS = [
  'APPIMAGE',
  'APPDIR',
  'ARGV0',
  'OWD',
  'APPIMAGE_LIBRARY_PATH'
] as const

/** Set by Electron, electron-vite or the app's own test launches; a shell started here must not inherit them. */
const APP_RUNTIME_KEYS = [
  'NODE_ENV',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_RENDERER_URL',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'APP_BACKGROUND_LAUNCH'
] as const

function withoutAppDirEntries(value: string | undefined, appDir: string): string | undefined {
  if (value === undefined) return undefined
  const kept = value
    .split(delimiter)
    .filter((entry) => {
      const normalized = entry.replace(/\/+$/, '')
      return normalized !== appDir && !normalized.startsWith(`${appDir}/`)
    })
    .join(delimiter)
  return kept.length > 0 ? kept : undefined
}

/** The AppImage loader's paths must not replace host commands or libraries in the user's shells. */
function removeAppImageRuntime(env: Record<string, string>, platform: NodeJS.Platform): void {
  if (platform !== 'linux' || (!env.APPIMAGE && !env.APPDIR && !env.ARGV0)) return
  const appDir = env.APPDIR?.trim().replace(/\/+$/, '')
  if (appDir?.startsWith('/')) {
    for (const key of ['PATH', 'LD_LIBRARY_PATH'] as const) {
      const cleaned = withoutAppDirEntries(env[key], appDir)
      if (cleaned === undefined) delete env[key]
      else env[key] = cleaned
    }
  }
  // An exported ARGV0 makes zsh run host commands under the AppImage's name.
  for (const key of APPIMAGE_RUNTIME_KEYS) delete env[key]
}

/**
 * The environment for a shell in a terminal: the app's own, minus what the app's runtime set for
 * itself, plus what terminal programs look for to enable colours, hyperlinks and UTF-8.
 */
export function terminalEnvironment(
  inherited: NodeJS.ProcessEnv,
  options: { platform: NodeJS.Platform; appVersion: string }
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(inherited)) {
    if (value !== undefined) env[key] = value
  }
  for (const key of APP_RUNTIME_KEYS) delete env[key]
  removeAppImageRuntime(env, options.platform)
  // Chromium's "no session bus" marker; children should find the real bus themselves.
  if (env.DBUS_SESSION_BUS_ADDRESS === 'disabled:') delete env.DBUS_SESSION_BUS_ADDRESS
  // The app's own log settings must not turn colour off in the user's shells.
  delete env.NO_COLOR
  if (env.FORCE_COLOR === '0') delete env.FORCE_COLOR
  if (env.CLICOLOR === '0') delete env.CLICOLOR

  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'Hatfield360'
  env.TERM_PROGRAM_VERSION = options.appVersion
  // supports-hyperlinks doesn't know this terminal by name, but xterm.js renders OSC 8 links.
  env.FORCE_HYPERLINK = '1'
  env.LANG ??= 'en_US.UTF-8'
  // Windows LANG doesn't reach Python's console encoding; without this CJK output comes out garbled.
  if (options.platform === 'win32') env.PYTHONUTF8 ??= '1'
  return env
}
