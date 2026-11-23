import type { SessionTelemetry, StatusEvent, StatusReply } from './status-protocol'

type Session = {
  id: string
  epoch: number
  provider: SessionTelemetry['provider']
  telemetry: Omit<SessionTelemetry, 'provider'> | null
}

export class StatusState {
  #session: Session | undefined
  #sequence = 0
  #recent = new Map<string, string>()

  snapshot() {
    return structuredClone(this.#session)
  }

  accept(event: StatusEvent, digest: string): StatusReply {
    const previous = this.#recent.get(event.eventId)
    if (previous !== undefined)
      return previous === digest
        ? { ok: true, status: 'duplicate' }
        : { ok: false, error: 'conflict' }
    if (event.sequence <= this.#sequence) return { ok: true, status: 'stale' }
    if (this.#session && event.sessionEpoch < this.#session.epoch)
      return { ok: true, status: 'stale' }
    const error = this.#apply(event)
    if (error) return { ok: false, error }
    this.#sequence = event.sequence
    this.#recent.set(event.eventId, digest)
    if (this.#recent.size > 128) {
      for (const oldest of this.#recent.keys()) {
        this.#recent.delete(oldest)
        break
      }
    }
    return { ok: true, status: 'accepted' }
  }

  #apply(event: StatusEvent): 'state' | 'conflict' | undefined {
    const session = this.#session
    const sameEpoch = session?.epoch === event.sessionEpoch
    if (
      sameEpoch &&
      (session.id !== event.sessionId ||
        (event.kind === 'session.snapshot' && session.provider !== event.provider))
    )
      return 'conflict'
    if (event.kind === 'session.snapshot') {
      if (sameEpoch && session.telemetry === null) return 'state'
      const { provider, turn, attention, activeSubagents, backgroundScripts, tool } = event
      this.#session = {
        id: event.sessionId,
        epoch: event.sessionEpoch,
        provider,
        telemetry: { turn, attention, activeSubagents, backgroundScripts, tool }
      }
      return undefined
    }
    if (!sameEpoch || session.telemetry === null) return 'state'
    if (event.kind === 'session.ended') session.telemetry = null
    return undefined
  }
}
