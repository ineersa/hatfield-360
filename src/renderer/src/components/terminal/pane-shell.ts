import type { ManagedPane } from '@/lib/pane-manager/pane-manager-types'
import { listenToSession } from '@/lib/terminal-output-router'
import type { TerminalExit } from '../../../../shared/terminal-api'

/** A shell resizes once the size settles, not on every frame of a window or divider drag. */
const RESIZE_SETTLE_MS = 60

export type PaneShell = {
  /** Ends the shell (if it still runs) and stops listening. */
  dispose: () => void
}

const mainErrorMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']*': (?:Error: )?/,
    ''
  )

function showExited(pane: ManagedPane, exit: TerminalExit): void {
  pane.container.dataset.exited = 'true'
  const badge = document.createElement('div')
  badge.className = 'pane-exit-badge'
  badge.setAttribute('role', 'status')
  badge.textContent = exit.signal
    ? `Process ended by signal ${exit.signal}`
    : `Process exited with code ${exit.exitCode}`
  pane.container.appendChild(badge)
  pane.terminal.options.cursorBlink = false
}

/**
 * Starts a shell for the pane once its terminal has its first size, and wires keys, output and
 * resizes. A shell that ends itself (`exit`, Ctrl+D) calls `onShellEnded`, whatever its exit code:
 * bash exits with its last command's status. One killed by a signal keeps its pane, with a badge,
 * so its last output can be read.
 */
export function startPaneShell(
  pane: ManagedPane,
  cwd: string | null,
  onShellEnded: () => void
): PaneShell {
  const { terminal } = pane
  let sessionId: string | null = null
  let exited = false
  let disposed = false
  let stopListening: (() => void) | null = null
  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  const typedBeforeStart: string[] = []

  const onData = terminal.onData((data) => {
    if (exited) return
    if (sessionId) void window.desktop.writeTerminal(sessionId, data).catch(() => undefined)
    else typedBeforeStart.push(data)
  })
  const onResize = terminal.onResize(({ cols, rows }) => {
    if (!sessionId || exited) return
    const id = sessionId
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      resizeTimer = null
      void window.desktop.resizeTerminal(id, cols, rows).catch(() => undefined)
    }, RESIZE_SETTLE_MS)
  })

  // Two frames: the pane's first fit runs on the next one, so the shell starts at the real size.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (disposed) return
      const { cols, rows } = terminal
      window.desktop
        .spawnTerminal({ ...(cwd ? { cwd } : {}), cols, rows })
        .then((session) => {
          if (disposed) {
            void window.desktop.killTerminal(session.id)
            return
          }
          sessionId = session.id
          pane.container.dataset.terminalId = session.id
          pane.container.dataset.pid = String(session.pid)
          stopListening = listenToSession(session.id, {
            data: (data) => terminal.write(data),
            exit: (exit) => {
              exited = true
              if (!exit.signal) onShellEnded()
              else showExited(pane, exit)
            }
          })
          for (const data of typedBeforeStart.splice(0)) {
            void window.desktop.writeTerminal(session.id, data).catch(() => undefined)
          }
          // The pane may have been resized while the shell was starting.
          if (terminal.cols !== cols || terminal.rows !== rows) {
            void window.desktop
              .resizeTerminal(session.id, terminal.cols, terminal.rows)
              .catch(() => undefined)
          }
        })
        .catch((error: unknown) => {
          exited = true
          terminal.write(`\x1b[31mThe shell couldn't start: ${mainErrorMessage(error)}\x1b[0m\r\n`)
        })
    })
  )

  return {
    dispose: () => {
      disposed = true
      if (resizeTimer) clearTimeout(resizeTimer)
      onData.dispose()
      onResize.dispose()
      stopListening?.()
      if (sessionId && !exited) void window.desktop.killTerminal(sessionId).catch(() => undefined)
    }
  }
}
