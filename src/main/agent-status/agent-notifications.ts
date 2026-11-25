import type { AgentNotification } from '../../shared/agent-api'
import type { StatusEvent } from './status-protocol'
import type { StatusState } from './status-state'

type Message = AgentNotification['message']

export class AgentNotificationPolicy {
  #epoch = 0
  #notified = new Set<string>()
  #closing = false

  beginClosing(): void {
    this.#closing = true
  }

  #first(key: string): boolean {
    if (this.#notified.has(key)) return false
    this.#notified.add(key)
    if (this.#notified.size > 128) {
      for (const oldest of this.#notified) {
        this.#notified.delete(oldest)
        break
      }
    }
    return true
  }

  accept(event: StatusEvent, session: NonNullable<ReturnType<StatusState['snapshot']>>): Message[] {
    if (session.epoch !== this.#epoch) {
      this.#epoch = session.epoch
      this.#notified.clear()
    }
    if (!session.telemetry) return []
    if (event.kind === 'notification')
      return [{ kind: 'explicit', title: event.title, body: event.body }]
    if (this.#closing) return []

    const { turn, attention, activeSubagents } = session.telemetry
    const messages: Message[] = []
    if (attention && this.#first(`attention:${attention.id}`))
      messages.push({ kind: 'needs-input' })
    if (turn?.status === 'failed' && this.#first(`failed:${turn.id}`))
      messages.push({ kind: 'failed' })
    if (
      turn?.status === 'completed' &&
      turn.trigger !== 'schedule' &&
      activeSubagents === 0 &&
      !attention &&
      this.#first(`completed:${turn.id}`)
    )
      messages.push({ kind: 'completed' })
    return messages
  }
}
