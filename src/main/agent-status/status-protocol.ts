type Validator = (value: unknown) => boolean

type Validated<T> = {
  [K in keyof T]: T[K] extends ((value: unknown) => value is infer V) ? V : never
}

const sequence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value)
const text =
  (limit: number) =>
  (value: unknown): value is string =>
    typeof value === 'string' && !/\p{Surrogate}/u.test(value) && Array.from(value).length <= limit
const oneOf =
  <const T extends string>(...values: T[]) =>
  (value: unknown): value is T =>
    values.some((candidate) => candidate === value)
const capability = oneOf('waits', 'actors', 'notifications', 'session-end')
type Capability = 'waits' | 'actors' | 'notifications' | 'session-end'
const capabilities = (value: unknown): value is Capability[] =>
  Array.isArray(value) &&
  value.length <= 4 &&
  value.every(capability) &&
  new Set(value).size === value.length
const actor = { actorId: id, actorStart: sequence }
const turn = { ...actor, turnId: id, turnStart: sequence }
const events = {
  'session.started': { provider: id, capabilities },
  'session.ended': {},
  'actor.started': { actorId: id, parentId: id, parentStart: sequence },
  'actor.ended': actor,
  'turn.started': { ...actor, turnId: id },
  'turn.ended': { ...turn, outcome: oneOf('completed', 'failed', 'cancelled', 'unknown') },
  'activity.changed': { ...turn, activity: oneOf('working', 'idle') },
  'wait.started': {
    ...turn,
    waitId: id,
    reason: oneOf('permission', 'question', 'external-input')
  },
  'wait.resolved': { ...turn, waitId: id, waitStart: sequence },
  notification: { title: text(200), body: text(2000) }
}
const envelope = {
  launchId: id,
  token: id,
  eventId: id,
  sequence,
  sessionId: id,
  sessionEpoch: sequence
}
type Kind = keyof typeof events
type Envelope = Validated<typeof envelope> & { version: 1; at?: string }
type Request = {
  [K in Kind]: Envelope & { kind: K } & Validated<(typeof events)[K]> & { tool?: string }
}[Kind]
export type StatusEvent = { [K in Kind]: Omit<Extract<Request, { kind: K }>, 'token'> }[Kind]
export type StatusReply =
  | { ok: true; status: 'accepted' | 'duplicate' | 'stale' }
  | { ok: false; error: 'invalid' | 'version' | 'unauthorized' | 'conflict' | 'state' | 'limit' }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function kind(value: unknown): value is Kind {
  return typeof value === 'string' && Object.hasOwn(events, value)
}

export function parseStatusRequest(value: unknown): Request | 'invalid' | 'version' {
  if (!record(value)) return 'invalid'
  if (value.version !== 1) return 'version'
  return validRequest(value) ? value : 'invalid'
}

function validRequest(value: Record<string, unknown>): value is Request {
  if (value.version !== 1 || !kind(value.kind)) return false
  const required: Record<string, Validator> = { ...envelope, ...events[value.kind] }
  const optional: Record<string, Validator> = {
    at: text(64),
    ...(value.kind === 'activity.changed' ? { tool: text(128) } : {})
  }
  if (
    !Object.entries(required).every(
      ([key, validate]) => Object.hasOwn(value, key) && validate(value[key])
    )
  )
    return false
  for (const key of Object.keys(value)) {
    if (key === 'version' || key === 'kind' || Object.hasOwn(required, key)) continue
    if (!Object.hasOwn(optional, key) || !optional[key]?.(value[key])) return false
  }
  return true
}
