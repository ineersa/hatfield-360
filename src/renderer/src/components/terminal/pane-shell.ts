import { notify } from '@/state/notification-store'
import type { AgentLaunch } from '../../../../shared/agent-api'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager-types'
import { listenToSession } from '@/lib/terminal-output-router'
import type { TerminalExit } from '../../../../shared/terminal-api'
import { mainErrorMessage } from '@/lib/main-error-message'

/** A shell resizes once the size settles, not on every frame of a window or divider drag. */
const RESIZE_SETTLE_MS = 60

export type PaneShell = {
  /** Ends the shell (if it still runs) and stops listening. */
  dispose: () => void
}

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
 * so its last output can be read, as does an agent that exits with a nonzero code.
 */
export function startPaneShell(
  pane: ManagedPane,
  cwd: string | null,
  onShellEnded: () => void,
  agent?: AgentLaunch,
  onStarted?: () => void,
  restoring = false
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
      const spawn =
        restoring && agent && !cwd
          ? Promise.reject(new Error('The saved terminal folder is unavailable.'))
          : agent
            ? window.desktop.launchAgent({ ...agent, cols, rows })
            : window.desktop.spawnTerminal({ ...(cwd ? { cwd } : {}), cols, rows })
      spawn
        .then((session) => {
          if (disposed) {
            void window.desktop.killTerminal(session.id)
            return
          }
          sessionId = session.id
          pane.container.dataset.terminalId = session.id
          pane.container.dataset.pid = String(session.pid)
          onStarted?.()
          stopListening = listenToSession(session.id, {
            // Acknowledged once xterm has parsed it, so main reads the shell only as fast as it draws.
            data: (data) =>
              terminal.write(data, () => {
                void window.desktop
                  .ackTerminalOutput(session.id, data.length)
                  .catch(() => undefined)
              }),
            exit: (exit) => {
              exited = true
              if (!exit.error && !exit.signal && (!agent || exit.exitCode === 0)) onShellEnded()
              else {
                showExited(pane, exit)
                if (restoring && agent)
                  notify({
                    severity: 'error',
                    title: 'Could not restore agent',
                    body: exit.error ?? `The agent exited with code ${exit.exitCode}.`
                  })
              }
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
          if (disposed) return
          exited = true
          pane.container.dataset.exited = 'true'
          if (restoring)
            notify({
              severity: 'error',
              title: 'Could not restore terminal',
              body: mainErrorMessage(error)
            })
          terminal.write(
            `\x1b[31mThe ${agent ? 'agent' : 'shell'} couldn't start: ${mainErrorMessage(error)}\x1b[0m\r\n`
          )
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
      if (sessionId) void window.desktop.killTerminal(sessionId).catch(() => undefined)
    }
  }
}
