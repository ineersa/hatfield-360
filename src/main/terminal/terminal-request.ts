import { isPlainObject } from '../../shared/plain-object'
import { TERMINAL_GRID_LIMIT } from '../../shared/terminal-api'

/** A typed-in paste can be large, but nothing a person sends at once comes near this. */
const MAX_WRITE_LENGTH = 1_000_000

function isCount(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max
}

/** A pty grid: positive whole columns and rows, within the limit. */
export function gridSize(cols: unknown, rows: unknown): { cols: number; rows: number } | null {
  return isCount(cols, TERMINAL_GRID_LIMIT.cols) && isCount(rows, TERMINAL_GRID_LIMIT.rows)
    ? { cols, rows }
    : null
}

/** The shape of a spawn request from the renderer; whether `cwd` is a directory is checked by main. */
export function parseSpawnRequest(
  value: unknown
): { cwd: string | null; cols: number; rows: number } | null {
  if (!isPlainObject(value)) return null
  const { cwd, cols, rows } = value
  if (cwd !== undefined && (typeof cwd !== 'string' || cwd.length === 0)) return null
  const size = gridSize(cols, rows)
  return size ? { cwd: cwd ?? null, ...size } : null
}

export function isTerminalId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value)
}

/** Only web links leave the app: `file:`, `javascript:` or custom schemes could run something locally. */
export function webLinkUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export function isTerminalInput(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_WRITE_LENGTH
}
