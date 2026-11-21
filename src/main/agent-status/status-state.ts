import type { StatusEvent, StatusReply } from './status-protocol'

type Turn = {
  id: string
  start: number
  activity: 'idle' | 'working'
  tool?: string
  outcome?: 'completed' | 'failed' | 'cancelled' | 'unknown'
  waits: Map<string, Wait>
}
type Wait = { start: number; reason: 'permission' | 'question' | 'external-input' }
type Actor = { start: number; parentId?: string; parentStart?: number; turn?: Turn }
type Session = {
  id: string
  epoch: number
  provider: string
  capabilities: string[]
  ended: boolean
  actors: Map<string, Actor>
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

  #apply(event: StatusEvent): 'state' | 'limit' | undefined {
    const session = this.#session
    if (event.kind === 'session.started') {
      if (session?.epoch === event.sessionEpoch) {
        if (
          session.id !== event.sessionId ||
          session.provider !== event.provider ||
          session.capabilities.length !== event.capabilities.length ||
          !event.capabilities.every((value) => session.capabilities.includes(value))
        )
          return 'state'
        return undefined
      }
      if (event.sessionEpoch !== event.sequence) return 'state'
      this.#session = {
        id: event.sessionId,
        epoch: event.sessionEpoch,
        provider: event.provider,
        capabilities: event.capabilities,
        ended: false,
        actors: new Map([['main', { start: event.sequence }]])
      }
      return undefined
    }
    if (
      !session ||
      session.ended ||
      session.id !== event.sessionId ||
      session.epoch !== event.sessionEpoch
    )
      return 'state'
    switch (event.kind) {
      case 'session.ended': {
        if (!session.capabilities.includes('session-end')) return 'state'
        session.ended = true
        const main = session.actors.get('main')
        session.actors.clear()
        if (main) {
          if (main.turn) {
            main.turn.waits.clear()
            main.turn.activity = 'idle'
            delete main.turn.tool
          }
          session.actors.set('main', main)
        }
        return undefined
      }
      case 'notification':
        return session.capabilities.includes('notifications') ? undefined : 'state'
      case 'actor.started': {
        if (
          !session.capabilities.includes('actors') ||
          session.actors.has(event.actorId) ||
          session.actors.get(event.parentId)?.start !== event.parentStart
        )
          return 'state'
        if (session.actors.size >= 32) return 'limit'
        session.actors.set(event.actorId, {
          start: event.sequence,
          parentId: event.parentId,
          parentStart: event.parentStart
        })
        return undefined
      }
      default:
        break
    }
    const actor = session.actors.get(event.actorId)
    if (!actor || actor.start !== event.actorStart) return 'state'
    if (event.kind === 'actor.ended') {
      if (event.actorId === 'main') return 'state'
      session.actors.delete(event.actorId)
      return undefined
    }
    if (event.kind === 'turn.started') {
      actor.turn = {
        id: event.turnId,
        start: event.sequence,
        activity: 'working',
        waits: new Map()
      }
      return undefined
    }
    const turn = actor.turn
    if (!turn || turn.outcome || turn.id !== event.turnId || turn.start !== event.turnStart)
      return 'state'
    switch (event.kind) {
      case 'turn.ended':
        turn.outcome = event.outcome
        turn.waits.clear()
        turn.activity = 'idle'
        delete turn.tool
        return undefined
      case 'activity.changed':
        turn.activity = event.activity
        if (event.tool !== undefined && event.activity === 'working') turn.tool = event.tool
        else delete turn.tool
        return undefined
      case 'wait.started':
        if (!session.capabilities.includes('waits') || turn.waits.has(event.waitId)) return 'state'
        if (turn.waits.size >= 16) return 'limit'
        turn.waits.set(event.waitId, { start: event.sequence, reason: event.reason })
        return undefined
      case 'wait.resolved':
        if (turn.waits.get(event.waitId)?.start !== event.waitStart) return 'state'
        turn.waits.delete(event.waitId)
        return undefined
    }
    return 'state'
  }
}
