// Ported from Orca (MIT, see THIRD_PARTY_NOTICES.md): pane-dom-creation.ts, pane-lifecycle.ts,
// pane-terminal-options.ts, terminal-fit/pane-fit.ts, pane-fit-measurability.ts,
// pane-fit-resize-observer.ts and terminal-rendering/pane-webgl-renderer.ts.
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal, type ITerminalOptions } from '@xterm/xterm'
import type { ManagedPaneInternal, PaneManagerOptions } from './pane-manager-types'

/** Below this a pane is hidden or mid-layout; fitting would pin its shell to a two-column grid. */
const MIN_FIT_BOX = { width: 48, height: 24 }
const MIN_FIT_GRID = { cols: 8, rows: 4 }

function defaultTerminalOptions(): ITerminalOptions {
  return {
    allowProposedApi: true,
    cursorBlink: true,
    cursorStyle: 'block',
    // An outline marks the cursor of a pane without focus.
    cursorInactiveStyle: 'outline',
    scrollback: 10_000,
    scrollSensitivity: 1.15,
    fastScrollSensitivity: 5,
    // On macOS, non-US layouts compose characters such as @ and € with Option.
    macOptionIsMeta: false,
    macOptionClickForcesSelection: true,
    drawBoldTextInBrightColors: true
  }
}

export function createPaneDom(
  id: number,
  options: PaneManagerOptions,
  onPointerDown: (id: number) => void
): ManagedPaneInternal {
  const container = document.createElement('div')
  container.className = 'pane'
  container.dataset.paneId = String(id)
  container.dataset.testid = 'terminal-pane'
  const xtermContainer = document.createElement('div')
  xtermContainer.className = 'xterm-container'
  container.appendChild(xtermContainer)

  const terminal = new Terminal({ ...defaultTerminalOptions(), ...options.terminalOptions() })
  const pane: ManagedPaneInternal = {
    id,
    terminal,
    container,
    xtermContainer,
    fitAddon: new FitAddon(),
    unicode11Addon: new Unicode11Addon(),
    webLinksAddon: new WebLinksAddon(options.onLinkClick),
    webglAddon: null,
    webglDisabledAfterContextLoss: false,
    gpuAcceleration: options.gpuAcceleration(),
    fitResizeObserver: null,
    pendingFitFrame: null,
    pointerDownHandler: () => onPointerDown(id)
  }
  container.addEventListener('pointerdown', () => pane.pointerDownHandler?.())
  return pane
}

function canMeasureForFit(pane: ManagedPaneInternal): boolean {
  const rect = pane.container.getBoundingClientRect()
  if (rect.width < MIN_FIT_BOX.width || rect.height < MIN_FIT_BOX.height) return false
  const dims = proposedDimensions(pane)
  return !!dims && dims.cols >= MIN_FIT_GRID.cols && dims.rows >= MIN_FIT_GRID.rows
}

function proposedDimensions(pane: ManagedPaneInternal): { cols: number; rows: number } | null {
  try {
    return pane.fitAddon.proposeDimensions() ?? null
  } catch {
    return null
  }
}

/** Fits the terminal to its pane, keeping the view at the bottom if it was there. */
export function safeFit(pane: ManagedPaneInternal): void {
  if (!canMeasureForFit(pane)) return
  const dims = proposedDimensions(pane)
  if (!dims || (dims.cols === pane.terminal.cols && dims.rows === pane.terminal.rows)) return
  const buffer = pane.terminal.buffer.active
  const atBottom = buffer.viewportY >= buffer.baseY
  try {
    pane.terminal.resize(dims.cols, dims.rows)
  } catch {
    return
  }
  if (atBottom) pane.terminal.scrollToBottom()
}

/** WebGL renders much faster than the DOM renderer; a lost GPU context falls back to the DOM for good. */
export function attachWebgl(pane: ManagedPaneInternal): void {
  if (pane.webglAddon || !pane.gpuAcceleration || pane.webglDisabledAfterContextLoss) return
  try {
    const addon = new WebglAddon()
    addon.onContextLoss(() => {
      pane.webglDisabledAfterContextLoss = true
      disposeWebgl(pane)
      pane.terminal.refresh(0, pane.terminal.rows - 1)
    })
    pane.terminal.loadAddon(addon)
    pane.webglAddon = addon
  } catch (error) {
    console.warn('WebGL terminal renderer unavailable, using the DOM renderer:', error)
    pane.webglAddon = null
  }
}

export function disposeWebgl(pane: ManagedPaneInternal): void {
  const addon = pane.webglAddon
  if (!addon) return
  pane.webglAddon = null
  try {
    addon.dispose()
  } catch {
    // Already torn down with a lost context.
  }
}

/** Opens xterm after the pane is in the document (xterm measures fonts on open). */
export function openTerminal(pane: ManagedPaneInternal): void {
  const { terminal } = pane
  terminal.open(pane.xtermContainer)
  terminal.loadAddon(pane.fitAddon)
  terminal.loadAddon(pane.webLinksAddon)
  terminal.loadAddon(pane.unicode11Addon)
  // Unicode 11 widths before any output: xterm bakes widths into cells, and the default v6 table
  // mismeasures CJK, emoji and ZWJ sequences.
  terminal.unicode.activeVersion = '11'
  attachWebgl(pane)
  // Box changes (window resize, divider drag, a tab shown again) refit on the next frame.
  pane.fitResizeObserver = new ResizeObserver(() => scheduleFit(pane))
  pane.fitResizeObserver.observe(pane.container)
  scheduleFit(pane)
}

function scheduleFit(pane: ManagedPaneInternal): void {
  if (pane.pendingFitFrame !== null) return
  pane.pendingFitFrame = requestAnimationFrame(() => {
    pane.pendingFitFrame = null
    safeFit(pane)
  })
}

export function disposePane(pane: ManagedPaneInternal): void {
  if (pane.pendingFitFrame !== null) cancelAnimationFrame(pane.pendingFitFrame)
  pane.pendingFitFrame = null
  pane.fitResizeObserver?.disconnect()
  pane.fitResizeObserver = null
  pane.pointerDownHandler = null
  disposeWebgl(pane)
  for (const addon of [pane.webLinksAddon, pane.unicode11Addon, pane.fitAddon]) {
    try {
      addon.dispose()
    } catch {
      // Already disposed with the terminal.
    }
  }
  try {
    pane.terminal.dispose()
  } catch {
    // Already disposed.
  }
}
