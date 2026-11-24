import { rgPath } from '@vscode/ripgrep'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { DEPENDENCY_FOLDER_NAMES } from '../../shared/dependency-folders'
import { isPlainObject } from '../../shared/plain-object'
import {
  SEARCH_MATCH_LIMIT,
  type SearchFileResult,
  type SearchMatch,
  type SearchQuery
} from '../../shared/search-api'
import { unpackedPath } from '../asar-unpacked-path'
import { isPathInside } from '../files/path-containment'

/** Longer lines are cut to this many characters around the match. */
const LINE_TEXT_LIMIT = 400
/** Characters kept before the match on a cut line. */
const LINE_TEXT_BEFORE = 80
/** Generated and data files this big are skipped, as JetBrains skips files too large to index. */
const MAX_FILE_SIZE = '20M'
/** Results are sent in batches at most this far apart, so a fast search isn't one message per file. */
const BATCH_INTERVAL_MS = 50

/** ripgrep globs from a file mask: comma-separated, `!` in front to leave files out. */
export function fileMaskGlobs(mask: string): string[] {
  return mask
    .split(',')
    .map((glob) => glob.trim())
    .filter((glob) => glob !== '' && glob !== '!')
}

/** ripgrep's arguments for `query` over `paths`: JSON output, never a shell, never following links. */
export function ripgrepArgs(query: SearchQuery, paths: string[]): string[] {
  const args = [
    '--json',
    // A user's ripgreprc must not change what the app finds.
    '--no-config',
    // Dotfiles (`.github`, `.env.example`) are searched, as JetBrains does; git's own folder never.
    '--hidden',
    '--glob=!.git',
    `--max-filesize=${MAX_FILE_SIZE}`,
    query.matchCase ? '--case-sensitive' : '--ignore-case'
  ]
  if (!query.regex) args.push('--fixed-strings')
  if (query.wholeWord) args.push('--word-regexp')
  if (query.includeNonProject) {
    args.push('--no-ignore')
  } else {
    for (const name of DEPENDENCY_FOLDER_NAMES) args.push(`--glob=!${name}`)
  }
  for (const glob of fileMaskGlobs(query.fileMask)) args.push(`--iglob=${glob}`)
  // `--regexp=` keeps a query that starts with `-` from reading as an option; `--` ends options before paths.
  args.push(`--regexp=${query.text}`, '--', ...paths)
  return args
}

type RipgrepMessage =
  | { kind: 'match'; path: string; matches: SearchMatch[] }
  /** Every match in the file has been reported. */
  | { kind: 'end'; path: string }

/**
 * A line of ripgrep's JSON output: a matched line or a file's end, or null for its other messages.
 * At most `limit` matches are read from a line.
 */
export function parseRipgrepLine(line: string, limit = SEARCH_MATCH_LIMIT): RipgrepMessage | null {
  let message: unknown
  try {
    message = JSON.parse(line)
  } catch {
    return null
  }
  if (!isPlainObject(message) || !isPlainObject(message.data)) return null
  const { path, lines, line_number: lineNumber, submatches } = message.data
  // Paths and lines that aren't UTF-8 come base64-encoded as `bytes`; they can't be shown or opened as text.
  if (!isPlainObject(path) || typeof path.text !== 'string') return null
  if (message.type === 'end') return { kind: 'end', path: path.text }
  if (message.type !== 'match') return null
  if (!isPlainObject(lines) || typeof lines.text !== 'string') return null
  if (typeof lineNumber !== 'number' || !Array.isArray(submatches)) return null
  const text = lines.text.replace(/\r?\n$/, '')
  const bytes = Buffer.from(text, 'utf8')
  const cut = text.length > LINE_TEXT_LIMIT
  const matches: SearchMatch[] = []
  // ripgrep's offsets are bytes; one pass turns them into editor columns, however many matches a
  // minified line has.
  let byteAt = 0
  let charAt = 0
  const columnOf = (offset: number): number => {
    charAt += bytes.subarray(byteAt, offset).toString('utf8').length
    byteAt = offset
    return charAt
  }
  for (const submatch of submatches) {
    if (matches.length >= limit) break
    if (!isPlainObject(submatch)) continue
    const { start, end } = submatch
    if (typeof start !== 'number' || typeof end !== 'number') continue
    if (start < byteAt || end < start || end > bytes.length) continue
    const from = columnOf(start)
    const to = columnOf(end)
    const textStart = cut ? Math.max(0, from - LINE_TEXT_BEFORE) : 0
    matches.push({
      line: lineNumber,
      start: from,
      end: to,
      text: cut ? text.slice(textStart, textStart + LINE_TEXT_LIMIT) : text,
      textStart
    })
  }
  return { kind: 'match', path: path.text, matches }
}

export type SearchListener = {
  results: (files: SearchFileResult[]) => void
  done: (limited: boolean, error: string | null) => void
}

/**
 * Runs ripgrep for `query` over `paths` (folders already checked to be inside the workspace),
 * streaming results to `listener` until it finishes, reaches the match limit or is stopped.
 * Returns a function that stops it; a stopped search reports nothing more.
 */
export function startRipgrep(
  query: SearchQuery,
  paths: string[],
  listener: SearchListener
): () => void {
  const child = spawn(unpackedPath(rgPath), ripgrepArgs(query, paths), {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  })
  let stopped = false
  let finished = false
  let count = 0
  let limited = false
  let errors = ''
  let pending: SearchFileResult[] = []
  /** The file ripgrep is reporting, sent once it ends. */
  let current: SearchFileResult | null = null
  // A file under two roots (a worktree inside its project) is reported once.
  const seen = new Set<string>()
  let timer: NodeJS.Timeout | null = null

  const flush = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    if (pending.length === 0 || stopped) return
    listener.results(pending)
    pending = []
  }
  const endFile = (): void => {
    if (!current) return
    pending.push(current)
    current = null
    timer ??= setTimeout(flush, BATCH_INTERVAL_MS)
  }
  const finish = (error: string | null): void => {
    if (finished) return
    finished = true
    endFile()
    flush()
    if (!stopped) listener.done(limited, error)
    stopped = true
  }

  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    if (stopped || limited) return
    const message = parseRipgrepLine(line, SEARCH_MATCH_LIMIT - count)
    if (!message) return
    if (message.kind === 'end') {
      if (current?.path === message.path) endFile()
      return
    }
    if (message.matches.length === 0) return
    // ripgrep doesn't follow links, so what it finds is under the paths it was given; checked all the same.
    if (!paths.some((root) => isPathInside(message.path, root))) return
    if (current?.path !== message.path) {
      if (seen.has(message.path)) return
      seen.add(message.path)
      endFile()
      current = { path: message.path, matches: [] }
    }
    const room = SEARCH_MATCH_LIMIT - count
    current.matches.push(...message.matches.slice(0, room))
    count += Math.min(room, message.matches.length)
    if (count >= SEARCH_MATCH_LIMIT) {
      limited = true
      child.kill()
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    if (errors.length < 4096) errors += chunk
  })
  child.on('error', (error) => finish(`Couldn't run ripgrep: ${error.message}`))
  // `close` waits for the output to be read to its end, unlike `exit`.
  child.on('close', (code) => {
    lines.close()
    // 0: found, 1: nothing found, 2: an error, such as a bad regex or a folder it couldn't read.
    const message = code === 2 || (code !== null && code > 2) ? ripgrepError(errors) : null
    finish(limited ? null : message)
  })

  return () => {
    if (stopped) return
    stopped = true
    if (timer) clearTimeout(timer)
    child.kill()
  }
}

/** ripgrep's complaint in one line: what is wrong with a regex, or the first file it couldn't read. */
export function ripgrepError(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((each) => each.replace(/^rg: /, '').trim())
    .filter((each) => each !== '')
  if (lines[0]?.startsWith('regex parse error')) {
    const reason = lines.find((each) => each.startsWith('error: '))
    return `Invalid regular expression${reason ? `: ${reason.slice('error: '.length)}` : ''}`
  }
  return lines[0] ?? 'ripgrep failed'
}
