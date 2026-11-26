import { isPlainObject } from '../../shared/plain-object'
import type { AgentProvider } from '../../shared/agent-api'
import type { MemoryEvidence, MemoryHit, MemoryImportance } from '../../shared/memory-search-api'

const MAX_CONTENT = 20_000
const MAX_EVIDENCE = 40
const MAX_EVIDENCE_TEXT = 1_200
const IMPORTANCE: readonly MemoryImportance[] = ['low', 'medium', 'high', 'critical']

function memoryProvider(sessionId: string): AgentProvider | null {
  if (/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(sessionId)) return 'claude'
  if (/^\d{1,128}$/.test(sessionId)) return 'hatfield'
  return null
}

/**
 * Observations carry `YYYY-MM-DD HH:MM` in UTC, like the journal events they come from;
 * reflections carry ISO 8601 with an offset.
 */
function librarianTime(value: unknown): number | null {
  if (typeof value !== 'string') return null
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const at = Date.parse(value)
    return Number.isFinite(at) ? at : null
  }
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute] = match.map(Number)
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  )
    return null
  const at = Date.UTC(year, month - 1, day, hour, minute)
  return Number.isFinite(at) ? at : null
}

/** The `after` filter in Librarian's own form and time zone. */
export function librarianDate(at: number): string {
  return new Date(at).toISOString().slice(0, 16).replace('T', ' ')
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function parseMemorySearch(value: Record<string, unknown>): {
  hits: MemoryHit[]
  partial: boolean
} {
  if (!Array.isArray(value.results)) throw new Error('Librarian returned no search results.')
  const hits: MemoryHit[] = []
  for (const row of value.results) {
    if (!isPlainObject(row)) continue
    const { id, kind, session_id: sessionId, content, importance } = row
    const at = librarianTime(row.timestamp)
    if (
      typeof id !== 'string' ||
      !/^[a-f\d]{12,64}$/.test(id) ||
      (kind !== 'observation' && kind !== 'reflection') ||
      typeof sessionId !== 'string' ||
      sessionId.length === 0 ||
      sessionId.length > 128 ||
      typeof content !== 'string' ||
      at === null
    )
      continue
    hits.push({
      id,
      kind,
      sessionId,
      provider: memoryProvider(sessionId),
      at,
      content: clip(content, MAX_CONTENT),
      importance: IMPORTANCE.find((level) => level === importance) ?? null
    })
  }
  return { hits, partial: value.partial === true }
}

function toolSummary(name: unknown, input: unknown): string | null {
  if (typeof name !== 'string') return null
  if (!isPlainObject(input)) return name
  const detail = [input.description, input.command, input.path, input.file_path, input.pattern]
    .concat(Object.values(input))
    .find((candidate): candidate is string => typeof candidate === 'string' && candidate !== '')
  return detail ? `${name}: ${detail}` : name
}

function blockText(block: unknown): string {
  if (typeof block === 'string') return block
  if (!isPlainObject(block)) return ''
  if (typeof block.text === 'string') return block.text
  if (Array.isArray(block.content)) return block.content.map(blockText).join('\n')
  return typeof block.content === 'string' ? block.content : ''
}

/** Readable lines from one journal event: Claude transcript records and Hatfield events differ. */
function eventEvidence(event: unknown): MemoryEvidence[] {
  if (!isPlainObject(event) || !isPlainObject(event.payload)) return []
  const { payload } = event
  const created = typeof event.created_at === 'string' ? Date.parse(event.created_at) : NaN
  const at = Number.isFinite(created) ? created : null
  // A Hatfield run starts with its whole prompt; only the user's own messages are evidence.
  if (event.type === 'run_started' && isPlainObject(payload.payload)) {
    const messages = Array.isArray(payload.payload.messages) ? payload.payload.messages : []
    return messages
      .filter((message) => isPlainObject(message) && message.role === 'user')
      .flatMap((message) => messageEvidence(message, at, event.type))
  }
  if (isPlainObject(payload.tool_result) && isPlainObject(payload.tool_result.result)) {
    const text = blockText(payload.tool_result.result).trim()
    return text ? [{ at, speaker: 'tool', text }] : []
  }
  const message = isPlainObject(payload.message)
    ? payload.message
    : isPlainObject(payload.assistant_message)
      ? payload.assistant_message
      : null
  if (!message) {
    return typeof payload.text === 'string' && payload.text.trim()
      ? [{ at, speaker: 'user', text: payload.text }]
      : []
  }
  return messageEvidence(message, at, event.type)
}

function messageEvidence(message: unknown, at: number | null, type: unknown): MemoryEvidence[] {
  if (!isPlainObject(message)) return []
  const speaker = message.role === 'user' || type === 'user' ? 'user' : 'assistant'
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
  const blocks: unknown[] = Array.isArray(message.content)
    ? message.content
    : typeof message.content === 'string'
      ? [message.content]
      : []
  const lines: MemoryEvidence[] = []
  for (const block of blocks) {
    if (isPlainObject(block) && block.type === 'thinking') continue
    if (isPlainObject(block) && block.type === 'tool_use') {
      const summary = toolSummary(block.name, block.input)
      if (summary) lines.push({ at, speaker: 'tool', text: summary })
      continue
    }
    if (isPlainObject(block) && block.type === 'tool_call') {
      const index = typeof block.tool_call_index === 'number' ? block.tool_call_index : -1
      const call: unknown = calls[index]
      const summary = isPlainObject(call) ? toolSummary(call.name, call.arguments) : null
      if (summary) lines.push({ at, speaker: 'tool', text: summary })
      continue
    }
    const text = blockText(block).trim()
    if (!text) continue
    lines.push({
      at,
      speaker: isPlainObject(block) && block.type === 'tool_result' ? 'tool' : speaker,
      text
    })
  }
  return lines
}

/** The memory's source events from Librarian's `recall`, oldest first, as bounded plain text. */
export function parseMemoryRecall(value: Record<string, unknown>): MemoryEvidence[] {
  if (!Array.isArray(value.events)) throw new Error('Librarian returned no evidence.')
  return value.events
    .flatMap(eventEvidence)
    .slice(0, MAX_EVIDENCE)
    .map((line) => ({ ...line, text: clip(line.text.trim(), MAX_EVIDENCE_TEXT) }))
}
