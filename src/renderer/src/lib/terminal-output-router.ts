import type { TerminalExit } from '../../../shared/terminal-api'

type SessionListener = { data: (data: string) => void; exit: (exit: TerminalExit) => void }

const listeners = new Map<string, SessionListener>()
/** Output that arrives before its pane registers (the shell can print before spawn resolves here). */
const early = new Map<string, { data: string[]; exit: TerminalExit | null }>()
let connected = false

function earlyFor(id: string): { data: string[]; exit: TerminalExit | null } {
  let pending = early.get(id)
  if (!pending) {
    pending = { data: [], exit: null }
    early.set(id, pending)
  }
  return pending
}

function connect(): void {
  if (connected) return
  connected = true
  window.desktop.subscribeTerminalData((id, data) => {
    const listener = listeners.get(id)
    if (listener) listener.data(data)
    else earlyFor(id).data.push(data)
  })
  window.desktop.subscribeTerminalExit((exit) => {
    const listener = listeners.get(exit.id)
    if (listener) listener.exit(exit)
    else earlyFor(exit.id).exit = exit
  })
}

/** Routes a shell's output and exit to its pane; one IPC subscription serves every pane. */
export function listenToSession(id: string, listener: SessionListener): () => void {
  connect()
  listeners.set(id, listener)
  const pending = early.get(id)
  early.delete(id)
  if (pending) {
    for (const data of pending.data) listener.data(data)
    if (pending.exit) listener.exit(pending.exit)
  }
  return () => {
    listeners.delete(id)
  }
}

/** Subscribes before the first spawn, so no output can arrive unrouted and be lost. */
export function connectTerminalOutput(): void {
  connect()
}

export function discardTerminalOutput(id: string): void {
  early.delete(id)
}
