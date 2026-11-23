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
function shape<T extends Record<string, Validator>>(fields: T) {
  return (value: unknown): value is Validated<T> =>
    record(value) &&
    Object.keys(value).length === Object.keys(fields).length &&
    Object.entries(fields).every(
      ([key, validate]) => Object.hasOwn(value, key) && validate(value[key])
    )
}
const nullable =
  <T>(validate: (value: unknown) => value is T) =>
  (value: unknown): value is T | null =>
    value === null || validate(value)
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1024
const provider = oneOf('hatfield', 'claude')
const snapshotFields = {
  provider,
  turn: nullable(
    shape({ id, status: oneOf('working', 'completed', 'failed', 'cancelled', 'unknown') })
  ),
  attention: nullable(shape({ id, reason: oneOf('permission', 'question', 'external-input') })),
  activeSubagents: nullable(count),
  backgroundScripts: nullable(count),
  tool: nullable(text(128))
}
export type SessionTelemetry = Validated<typeof snapshotFields>
const events = {
  'session.snapshot': snapshotFields,
  'session.ended': {},
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
  [K in Kind]: Envelope & { kind: K } & Validated<(typeof events)[K]>
}[Kind]
export type StatusEvent = { [K in Kind]: Omit<Extract<Request, { kind: K }>, 'token'> }[Kind]
const bootstrapToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
const kernelNumber = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value)

export function parseRegistration(value: Record<string, unknown>) {
  const { bootstrapToken: token, instanceId, provider: providerId, owner } = value
  if (
    Object.keys(value).length !== 6 ||
    !bootstrapToken(token) ||
    !uuid(instanceId) ||
    !provider(providerId) ||
    !record(owner) ||
    Object.keys(owner).length !== 3 ||
    !sequence(owner.pid) ||
    owner.pid > 0x7fffffff ||
    !kernelNumber(owner.pidNamespace) ||
    !kernelNumber(owner.startTicks)
  )
    return undefined
  return {
    token,
    instanceId,
    provider: providerId,
    owner: { pid: owner.pid, pidNamespace: owner.pidNamespace, startTicks: owner.startTicks }
  }
}

export type Registration = NonNullable<ReturnType<typeof parseRegistration>>

export type StatusReply =
  | { ok: true; status: 'accepted' | 'duplicate' | 'stale' }
  | {
      ok: false
      error: 'invalid' | 'version' | 'unauthorized' | 'conflict' | 'state' | 'limit' | 'unavailable'
    }

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
    at: text(64)
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
  return (
    sequence(value.sessionEpoch) && sequence(value.sequence) && value.sessionEpoch <= value.sequence
  )
}
