import {
  applyEdits,
  modify,
  type ParseError,
  parse,
  parseTree,
  printParseErrorCode
} from 'jsonc-parser'
import { isPlainObject } from '../../shared/plain-object'
import {
  DEFAULT_SETTINGS,
  FONT_SIZE_RANGE,
  ICON_THEMES,
  type SettingKey,
  type Settings
} from '../../shared/settings-api'
import { APP_THEMES } from '../../shared/themes/app-theme-catalog'
import { EDITOR_THEMES } from '../../shared/themes/editor-theme-catalog'
import { TERMINAL_THEMES } from '../../shared/themes/terminal-theme-catalog'

export type ParsedSettings = {
  values: Settings
  /** Settings the file sets, in file order. */
  customized: SettingKey[]
  /** The file is a JSON object (or empty) with each key once, so single settings can be written into it. */
  editable: boolean
  /** One line per problem, in file order; empty when the file is fine. */
  problems: string[]
}

/** A checked value, or why it was rejected. A clamped value is used but still reported. */
type Checked<T> = { value: T; problem?: string } | { problem: string }

/** Settings with quotes and spaces end up in CSS `font-family`; the length cap keeps a typo from becoming a wall of text. */
const MAX_FONT_FAMILY_LENGTH = 500

function fontFamily(value: unknown): Checked<string> {
  if (typeof value !== 'string' || value.trim() === '') return { problem: 'must be a font name' }
  if (value.length > MAX_FONT_FAMILY_LENGTH) return { problem: 'is too long' }
  // A semicolon or brace would end the CSS declaration it is put into.
  if (/[;{}]/.test(value)) return { problem: 'must not contain ; { or }' }
  return { value: value.trim() }
}

function fontSize(value: unknown): Checked<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { problem: 'must be a number' }
  const { min, max } = FONT_SIZE_RANGE
  const clamped = Math.min(max, Math.max(min, value))
  return clamped === value
    ? { value }
    : { value: clamped, problem: `must be between ${min} and ${max}; using ${clamped}` }
}

/** Checks a value is one of `choices`. */
function oneOf<T extends string>(choices: readonly T[]): (value: unknown) => Checked<T> {
  return (value) => {
    const choice = choices.find((candidate) => candidate === value)
    return choice
      ? { value: choice }
      : { problem: `must be one of ${choices.map((name) => `"${name}"`).join(', ')}` }
  }
}

const ids = <T extends string>(themes: readonly { id: T }[]): T[] => themes.map(({ id }) => id)

function flag(value: unknown): Checked<boolean> {
  return typeof value === 'boolean' ? { value } : { problem: 'must be true or false' }
}

const CHECKS: { [K in SettingKey]: (value: unknown) => Checked<Settings[K]> } = {
  'app.fontFamily': fontFamily,
  'app.fontSize': fontSize,
  'terminal.fontFamily': fontFamily,
  'terminal.fontSize': fontSize,
  'terminal.gpuAcceleration': flag,
  'editor.fontFamily': fontFamily,
  'editor.fontSize': fontSize,
  'workbench.iconTheme': oneOf(ICON_THEMES),
  'workbench.colorTheme': oneOf(ids(APP_THEMES)),
  'editor.colorTheme': oneOf(ids(EDITOR_THEMES)),
  'terminal.colorTheme': oneOf(ids(TERMINAL_THEMES))
}

export const isSettingKey = (key: string): key is SettingKey => Object.hasOwn(CHECKS, key)

/** `CloseBraceExpected` → `close brace expected`. */
function describeParseError(error: ParseError): string {
  return printParseErrorCode(error.error)
    .replaceAll(/(?<=[a-z])(?=[A-Z])/g, ' ')
    .toLowerCase()
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length
}

/** Keys the file sets more than once; JSON uses the last, but an edit would only change the first. */
function duplicateKeys(text: string): string[] {
  const keys = (parseTree(text, [], { allowTrailingComma: true })?.children ?? []).flatMap(
    (property) => {
      const key: unknown = property.children?.[0]?.value
      return typeof key === 'string' ? [key] : []
    }
  )
  return [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))]
}

function applySetting<K extends SettingKey>(
  values: Pick<Settings, K>,
  key: K,
  raw: unknown,
  lastGood: Pick<Settings, K>,
  problems: string[]
): void {
  const checked = CHECKS[key](raw)
  // A bad value keeps what was in effect, so a half-typed edit doesn't reset the app.
  values[key] = 'value' in checked ? checked.value : lastGood[key]
  if (checked.problem) problems.push(`"${key}" ${checked.problem}.`)
}

/**
 * Reads settings.json contents (JSON with comments and trailing commas, like VS Code). Missing keys
 * use defaults; bad values and an unreadable file keep `lastGood`.
 */
export function parseSettings(text: string, lastGood: Settings): ParsedSettings {
  if (text.trim() === '') {
    return { values: { ...DEFAULT_SETTINGS }, customized: [], editable: true, problems: [] }
  }
  const unchanged = { values: lastGood, customized: [], editable: false }
  const errors: ParseError[] = []
  const data: unknown = parse(text, errors, { allowTrailingComma: true })
  const [error] = errors
  if (error) {
    return {
      ...unchanged,
      problems: [
        `settings.json is not valid JSON (line ${lineOf(text, error.offset)}: ${describeParseError(error)}); keeping the previous settings.`
      ]
    }
  }
  if (!isPlainObject(data)) {
    return {
      ...unchanged,
      problems: ['settings.json must be a JSON object; keeping the previous settings.']
    }
  }
  const values: Settings = { ...DEFAULT_SETTINGS }
  const customized: SettingKey[] = []
  const problems: string[] = []
  for (const [key, raw] of Object.entries(data)) {
    if (isSettingKey(key)) {
      applySetting(values, key, raw, lastGood, problems)
      customized.push(key)
    } else {
      problems.push(`Unknown setting "${key}".`)
    }
  }
  const duplicates = duplicateKeys(text)
  for (const key of duplicates) {
    problems.push(`"${key}" is set more than once; the last one is used. Remove the others.`)
  }
  return { values, customized, editable: duplicates.length === 0, problems }
}

/** A value from the Settings page: checked like the file's, clamped sizes accepted, anything else refused. */
export function checkSettingValue<K extends SettingKey>(key: K, raw: unknown): Settings[K] {
  const checked = CHECKS[key](raw)
  if (!('value' in checked)) throw new Error(`"${key}" ${checked.problem}.`)
  return checked.value
}

/**
 * settings.json contents with one setting changed, keeping the user's comments and layout. A
 * default value is removed instead, so the file holds only what the user changed.
 */
export function withSetting<K extends SettingKey>(
  text: string,
  key: K,
  value: Settings[K] | null
): string {
  const kept = value === null || value === DEFAULT_SETTINGS[key] ? undefined : value
  const base = text.trim() === '' ? '{}\n' : text
  const edits = modify(base, [key], kept, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' }
  })
  return applyEdits(base, edits)
}
