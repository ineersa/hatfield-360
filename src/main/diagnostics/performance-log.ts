import { MAX_SCRIPTS } from '../../shared/diagnostics-api'
import { isPlainObject } from '../../shared/plain-object'
import type { LogFile } from '../logs/log-file'

/** One app run writes at most this many lines, so a page stuck in slow frames can't fill the disk. */
const MAX_LINES = 500
const MAX_TEXT = 300

/** One line of plain text from untrusted input: no control characters or line separators, capped. */
function plain(value: string): string {
  const characters = Array.from(value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').trim())
  return characters.length > MAX_TEXT
    ? `${characters.slice(0, MAX_TEXT - 1).join('')}…`
    : characters.join('')
}

const milliseconds = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null

/** The scripts part of a line; a malformed entry is left out rather than refusing the report. */
function scriptsText(raw: unknown): string {
  if (!Array.isArray(raw)) return ''
  const scripts = raw
    .slice(0, MAX_SCRIPTS)
    .filter(isPlainObject)
    .flatMap((script) => {
      const duration = milliseconds(script.duration)
      if (
        typeof script.invoker !== 'string' ||
        typeof script.source !== 'string' ||
        duration === null
      )
        return []
      return [`${plain(script.invoker)} ${plain(script.source)} ${duration} ms`]
    })
  return scripts.length > 0 ? ` · scripts: ${scripts.join('; ')}` : ''
}

/** The log line for a slow page frame reported by the renderer, or null when the report is malformed. */
export function slowTaskLine(raw: unknown, now: Date): string | null {
  if (!isPlainObject(raw) || typeof raw.view !== 'string') return null
  const duration = milliseconds(raw.duration)
  if (duration === null) return null
  let action = 'no action yet'
  if (isPlainObject(raw.action)) {
    const before = milliseconds(raw.action.before)
    if (typeof raw.action.label !== 'string' || before === null) return null
    action = `after ${plain(raw.action.label)} ${before} ms before`
  } else if (raw.action !== null) return null
  return `${now.toISOString()} renderer frame ${duration} ms · view ${plain(raw.view)} · ${action}${scriptsText(raw.scripts)}`
}

/**
 * The log line for a main-process stall. The stall is seen only after it ended, so the requests
 * still pending were waiting, not running: a slow handler gets its own line from `slowHandlerLine`.
 */
export function stallLine(
  duration: number,
  pending: { channel: string; age: number }[],
  now: Date
): string {
  const waiting =
    pending.length > 0
      ? `pending ${pending.map(({ channel, age }) => `${channel} (started ${Math.round(age)} ms before)`).join(', ')}`
      : 'no IPC request pending'
  return `${now.toISOString()} main stall ${Math.round(duration)} ms · ${waiting}`
}

/** The log line for an IPC handler that kept main busy itself before returning. */
export function slowHandlerLine(channel: string, duration: number, now: Date): string {
  return `${now.toISOString()} main handler ${channel} ran ${Math.round(duration)} ms without yielding`
}

/** The performance log: capped lines, each also printed to stderr, where `pnpm dev` shows it. */
export class PerformanceLog {
  private lines = 0

  constructor(private readonly file: () => LogFile) {}

  write(line: string): void {
    if (this.lines > MAX_LINES) return
    this.lines += 1
    const text = this.lines > MAX_LINES ? 'Further entries dropped for this run.' : line
    const file = this.file()
    file.write(`${text}\n`)
    void file.flushed().then(() => console.warn(`[performance] ${text}`))
  }
}
