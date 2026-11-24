import { basename } from 'node:path'
import type { AgentProfile, AgentProvider } from '../../shared/agent-api'

const selectors =
  /^(?:-r|-c|-p|--resume|--continue|--fork-session|--session-id|--prompt|--print|--from-pr)$/
const hatfieldOverrides =
  /^(?:--cwd|--storage(?:-path|-dir)?|--session(?:-store|-dir|-path)?|--headless|--controller)$/
const claudeSingleValues = new Set([
  '--model',
  '--permission-mode',
  '--effort',
  '--plugin-dir',
  '--settings'
])
const hatfieldSingleValues = new Set([
  '--model',
  '--reasoning',
  '--transport',
  '--skills-path',
  '--skills',
  '--tools'
])

export function acceptsResumeArguments(provider: AgentProvider, profile: AgentProfile): boolean {
  const direct = basename(profile.executable) === provider
  const singleValues = provider === 'claude' ? claudeSingleValues : hatfieldSingleValues
  let expectsValue = false
  for (const argument of profile.args) {
    const [option = ''] = argument.split('=', 1)
    if (
      argument === '--' ||
      selectors.test(option) ||
      (provider === 'hatfield' && hatfieldOverrides.test(option))
    )
      return false
    if (!direct) continue
    if (expectsValue && !argument.startsWith('-')) {
      expectsValue = false
      continue
    }
    if (expectsValue || !argument.startsWith('--') || !option.slice(2)) return false
    expectsValue = argument === option && singleValues.has(option)
  }
  return !expectsValue
}
