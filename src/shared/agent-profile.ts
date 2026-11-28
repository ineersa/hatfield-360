import type { AgentProfile } from './agent-api'
import { isPlainObject } from './plain-object'

const SHAPE =
  'must contain an executable, an array of string arguments and an env object of strings'
const MAX_ARGS = 64
const MAX_ENV = 64
const MAX_TEXT = 4096
const ENV_NAME = /^[A-Za-z_]\w{0,127}$/
/** Variables Hatfield 360 sets itself for an agent's status reporting. */
const RESERVED_ENV = /^H360_/

const hasControl = (text: string): boolean =>
  Array.from(text).some((character) => character.charCodeAt(0) < 32 || character === '\x7f')

/** A value the shell runs as a file path, where spaces belong to the name. */
const isPathExecutable = (executable: string): boolean => /^(?:\/|~\/|\.\.?\/)/.test(executable)

/** Why `executable` can't be run as one program, or null when it can. */
function executableProblem(executable: string): string | null {
  if (!executable || executable.length > MAX_TEXT || hasControl(executable))
    return 'must be a program name or path'
  const assignment = /^([A-Za-z_]\w*)=/.exec(executable)?.[1]
  if (assignment)
    return `must be a program, not a variable assignment: put ${assignment} in Environment`
  if (/\s/.test(executable) && !isPathExecutable(executable)) {
    const [program = '', ...rest] = executable.split(/\s+/)
    return `must be one program: put ${program} here and ${JSON.stringify(rest)} in Arguments`
  }
  return null
}

/** Why `name` can't be set for an agent, or null when it can. */
function environmentNameProblem(name: string): string | null {
  if (!ENV_NAME.test(name)) return `"${name}" is not an environment variable name`
  if (RESERVED_ENV.test(name)) return `"${name}" is set by Hatfield 360 itself`
  return null
}

/** A launch profile from settings or the Settings page, trimmed, or what is wrong with it. */
export function checkAgentProfile(raw: unknown): { value: AgentProfile } | { problem: string } {
  if (!isPlainObject(raw) || typeof raw.executable !== 'string' || !Array.isArray(raw.args))
    return { problem: SHAPE }
  const executable = raw.executable.trim()
  const problem = executableProblem(executable)
  if (problem) return { problem: `executable ${problem}` }
  const { args } = raw
  if (
    args.length > MAX_ARGS ||
    !args.every(
      (arg: unknown): arg is string =>
        typeof arg === 'string' && arg.length <= MAX_TEXT && !arg.includes('\0')
    )
  )
    return { problem: SHAPE }
  const rawEnv = raw.env ?? {}
  if (!isPlainObject(rawEnv) || Object.keys(rawEnv).length > MAX_ENV) return { problem: SHAPE }
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(rawEnv)) {
    const nameProblem = environmentNameProblem(name)
    if (nameProblem) return { problem: `env ${nameProblem}` }
    if (typeof value !== 'string') return { problem: `env "${name}" must be a string` }
    if (value.length > MAX_TEXT || hasControl(value))
      return { problem: `env "${name}" must be text on one line` }
    env[name] = value
  }
  return { value: { executable, args, env } }
}
