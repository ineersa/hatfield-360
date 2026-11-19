import { type ParseError, parse, printParseErrorCode } from 'jsonc-parser'
import { isPlainObject } from '../../shared/plain-object'
import {
  DEFAULT_SETTINGS,
  FONT_SIZE_RANGE,
  ICON_THEMES,
  type IconTheme,
  type Settings
} from '../../shared/settings-api'

export type ParsedSettings = {
  values: Settings
  /** One line per problem, in file order; empty when the file is fine. */
  problems: string[]
}

type SettingKey = keyof Settings

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

function iconTheme(value: unknown): Checked<IconTheme> {
  const theme = ICON_THEMES.find((candidate) => candidate === value)
  return theme
    ? { value: theme }
    : { problem: `must be one of ${ICON_THEMES.map((name) => `"${name}"`).join(', ')}` }
}

const CHECKS: { [K in SettingKey]: (value: unknown) => Checked<Settings[K]> } = {
  'app.fontFamily': fontFamily,
  'app.fontSize': fontSize,
  'terminal.fontFamily': fontFamily,
  'terminal.fontSize': fontSize,
  'editor.fontFamily': fontFamily,
  'editor.fontSize': fontSize,
  'workbench.iconTheme': iconTheme
}

const isSettingKey = (key: string): key is SettingKey => Object.hasOwn(CHECKS, key)

/** `CloseBraceExpected` → `close brace expected`. */
function describeParseError(error: ParseError): string {
  return printParseErrorCode(error.error)
    .replaceAll(/(?<=[a-z])(?=[A-Z])/g, ' ')
    .toLowerCase()
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length
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
  if (text.trim() === '') return { values: { ...DEFAULT_SETTINGS }, problems: [] }
  const errors: ParseError[] = []
  const data: unknown = parse(text, errors, { allowTrailingComma: true })
  const [error] = errors
  if (error) {
    return {
      values: lastGood,
      problems: [
        `settings.json is not valid JSON (line ${lineOf(text, error.offset)}: ${describeParseError(error)}); keeping the previous settings.`
      ]
    }
  }
  if (!isPlainObject(data)) {
    return {
      values: lastGood,
      problems: ['settings.json must be a JSON object; keeping the previous settings.']
    }
  }
  const values: Settings = { ...DEFAULT_SETTINGS }
  const problems: string[] = []
  for (const [key, raw] of Object.entries(data)) {
    if (isSettingKey(key)) applySetting(values, key, raw, lastGood, problems)
    else problems.push(`Unknown setting "${key}".`)
  }
  return { values, problems }
}
