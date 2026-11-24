import { type ParseError, parse } from 'jsonc-parser'
import { keyStringAccelerators } from '../../shared/key-strings'
import type { UserKeybinding } from '../../shared/keybindings-api'
import { shellCommand } from '../../shared/keymap'
import { isPlainObject } from '../../shared/plain-object'
import { describeParseError, lineOf } from '../settings/settings-document'

export type ParsedKeybindings = {
  /** The usable entries in file order, or null when the file isn't a JSON list at all. */
  entries: UserKeybinding[] | null
  /** One line per problem, in file order; empty when the file is fine. */
  problems: string[]
}

/** Why an entry can't be used, or null when it can. */
function entryProblem(raw: Record<string, unknown>, platform: string): string | null {
  const { key, command, when } = raw
  if (typeof command !== 'string' || command === '' || command === '-') {
    return 'needs a "command"'
  }
  const removal = command.startsWith('-')
  if (key === undefined && !removal) return 'needs a "key"'
  if (key !== undefined) {
    if (typeof key !== 'string') return '"key" must be a string'
    const accelerators = keyStringAccelerators(key, platform)
    if (accelerators === null) return `has a key the app can't read: "${key}"`
    const target = shellCommand(removal ? command.slice(1) : command)
    if (target && accelerators.length > 1) {
      return `binds ${command} to two chords; app and terminal keys are one chord`
    }
  }
  const id = removal ? command.slice(1) : command
  if (id.startsWith('hatfield.') && id !== 'hatfield.save' && !shellCommand(id)) {
    return `runs ${id}, which isn't a Hatfield 360 command`
  }
  if (when !== undefined && typeof when !== 'string') return '"when" must be a string'
  // The app and terminals don't evaluate VS Code contexts; a condition they'd ignore isn't taken.
  if (when !== undefined && shellCommand(id)) {
    return `gives ${id} a "when"; app and terminal keys can't have one`
  }
  return null
}

/**
 * Reads keybindings.json contents (JSON with comments and trailing commas, like VS Code). Bad
 * entries are left out; a file that isn't a list keeps nothing, so the caller keeps the last good
 * entries.
 */
export function parseKeybindings(text: string, platform: string): ParsedKeybindings {
  if (text.trim() === '') return { entries: [], problems: [] }
  const errors: ParseError[] = []
  const data: unknown = parse(text, errors, { allowTrailingComma: true })
  const [error] = errors
  if (error) {
    return {
      entries: null,
      problems: [
        `keybindings.json is not valid JSON (line ${lineOf(text, error.offset)}: ${describeParseError(error)}); keeping the previous keys.`
      ]
    }
  }
  if (!Array.isArray(data)) {
    return {
      entries: null,
      problems: ['keybindings.json must be a list of entries; keeping the previous keys.']
    }
  }
  const entries: UserKeybinding[] = []
  const problems: string[] = []
  for (const [index, raw] of data.entries()) {
    const problem = isPlainObject(raw) ? entryProblem(raw, platform) : 'must be an object'
    const { key, command, when, args } = isPlainObject(raw) ? raw : {}
    if (problem !== null || typeof command !== 'string') {
      problems.push(`Entry ${index + 1} ${problem ?? 'needs a "command"'}; it is ignored.`)
      continue
    }
    entries.push({
      key: typeof key === 'string' ? key : null,
      command,
      ...(typeof when === 'string' ? { when } : {}),
      ...(args === undefined ? {} : { args })
    })
  }
  return { entries, problems }
}
