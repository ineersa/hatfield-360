// The cassette format shared by the recorder and the replayer.
// A cassette is JSONL: a header line, then one line per JSON-RPC message with who sent it.
// Values that differ between runs are placeholders: `<cwd>`, `<home>`, `<id:N>` for each distinct
// UUID, `<time>` for timestamps. The replayer binds them to what the client actually sends.

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g
const PLACEHOLDER = /<cwd>|<home>|<id:\d+>|<time>/g
const FIXED_TIME = '2026-01-01T00:00:00.000Z'
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g

/** Agent messages the app ignores that carry the account (email, plan) or are noise; not kept. */
const DROPPED_METHODS = new Set(['_auth/status_update', 'auth/status_update'])
const DROPPED_UPDATES = new Set(['available_commands_update', 'usage_update'])

const dropped = ({ from, message }) =>
  from === 'agent' &&
  (DROPPED_METHODS.has(message.method) ||
    (message.method === 'session/update' &&
      DROPPED_UPDATES.has(message.params?.update?.sessionUpdate)))

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Maps every string in a JSON value. */
export function mapStrings(value, map) {
  if (typeof value === 'string') return map(value)
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, map))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, mapStrings(item, map)])
    )
  return value
}

/** Replaces run-specific values in recorded messages with placeholders. */
export function normalize(entries, { cwd, home }) {
  const ids = new Map()
  const replace = (text) =>
    text
      .split(cwd)
      .join('<cwd>')
      .split(home)
      .join('<home>')
      .replace(UUID, (uuid) => {
        const key = uuid.toLowerCase()
        if (!ids.has(key)) ids.set(key, `<id:${ids.size + 1}>`)
        return ids.get(key)
      })
      .replace(ISO_TIME, '<time>')
      .replace(EMAIL, 'user@example.com')
  return entries
    .filter((entry) => !dropped(entry))
    .map((entry) => ({ from: entry.from, message: mapStrings(entry.message, replace) }))
}

/** Parses a cassette's text into its header and entries. */
export function parseCassette(text) {
  const [header, ...entries] = text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line))
  if (!header || typeof header.adapter !== 'string') throw new Error('Cassette has no header line')
  return { header, entries }
}

export function serializeCassette(header, entries) {
  return [header, ...entries].map((line) => JSON.stringify(line)).join('\n') + '\n'
}

/** Placeholders bound to the values seen in this run. */
export class Bindings {
  constructor(initial) {
    this.values = new Map(Object.entries(initial))
  }

  /** A recorded agent message with the bound values filled in. */
  fill(value) {
    return mapStrings(value, (text) =>
      text.replace(PLACEHOLDER, (placeholder) =>
        placeholder === '<time>' ? FIXED_TIME : (this.values.get(placeholder) ?? placeholder)
      )
    )
  }

  /**
   * Whether the client's message matches the recorded one, binding placeholders it sees for the
   * first time. Bindings are only kept when the whole message matches.
   */
  match(recorded, actual) {
    const found = new Map()
    const same = (want, got) => {
      if (typeof want === 'string') {
        if (typeof got !== 'string') return false
        const names = want.match(PLACEHOLDER)
        if (!names) return want === got
        const pattern = new RegExp(
          `^${want.split(PLACEHOLDER).map(escapeRegExp).join('(.*?)')}$`,
          's'
        )
        const groups = pattern.exec(got)
        if (!groups) return false
        return names.every((name, index) => {
          const value = groups[index + 1]
          if (name === '<time>') return true
          const known = found.get(name) ?? this.values.get(name)
          if (known !== undefined) return known === value
          found.set(name, value)
          return true
        })
      }
      if (Array.isArray(want))
        return (
          Array.isArray(got) &&
          want.length === got.length &&
          want.every((item, i) => same(item, got[i]))
        )
      if (want && typeof want === 'object') {
        if (!got || typeof got !== 'object' || Array.isArray(got)) return false
        const keys = new Set([...Object.keys(want), ...Object.keys(got)])
        return [...keys].every((key) => same(want[key], got[key]))
      }
      return want === got
    }
    if (!same(recorded, actual)) return false
    for (const [name, value] of found) this.values.set(name, value)
    return true
  }
}
