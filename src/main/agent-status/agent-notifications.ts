import type { AgentNotification } from '../../shared/agent-api'
import type { StatusEvent } from './status-protocol'
import type { StatusState } from './status-state'

type Message = AgentNotification['message']

export class AgentNotificationPolicy {
  #waiting = false
  #epoch = 0
  #completion: number | undefined
  #closing = false

  beginClosing(): void {
    this.#closing = true
  }

  accept(event: StatusEvent, session: NonNullable<ReturnType<StatusState['snapshot']>>): Message[] {
    if (session.epoch !== this.#epoch) {
      this.#epoch = session.epoch
      this.#waiting = false
      this.#completion = undefined
    }
    if (session.ended) return []
    if (event.kind === 'notification')
      return [{ kind: 'explicit', title: event.title, body: event.body }]

    if (this.#closing) return []

    const messages: Message[] = []
    const actors = [...session.actors.values()]
    const waiting = actors.some((actor) => actor.turn && actor.turn.waits.size > 0)
    if (waiting && !this.#waiting) messages.push({ kind: 'needs-input' })
    this.#waiting = waiting

    if (event.kind === 'turn.ended' && event.actorId === 'main') {
      if (event.outcome === 'failed') messages.push({ kind: 'failed' })
      if (event.outcome === 'completed') this.#completion = event.turnStart
    }
    const mainTurn = session.actors.get('main')?.turn
    // A newer main turn supersedes a completion that never settled.
    if (mainTurn?.start !== this.#completion) this.#completion = undefined
    if (
      this.#completion !== undefined &&
      !waiting &&
      session.scripts.size === 0 &&
      ![...session.actors].some(
        ([id, actor]) => actor.turn?.activity === 'working' || (id !== 'main' && !actor.turn)
      )
    ) {
      this.#completion = undefined
      messages.push({ kind: 'completed' })
    }
    return messages
  }
}
