import type { FitAddon } from '@xterm/addon-fit'
import type { Unicode11Addon } from '@xterm/addon-unicode11'
import type { WebLinksAddon } from '@xterm/addon-web-links'
import type { WebglAddon } from '@xterm/addon-webgl'
import type { ITerminalOptions, Terminal } from '@xterm/xterm'

export type SplitDirection = 'vertical' | 'horizontal'

/** The edge of a target pane that a dragged pane docks to. */
export type DropZone = 'left' | 'right' | 'top' | 'bottom'

export type PaneManagerOptions = {
  /** A new pane's terminal is open and in the tree; bind it to a shell here. */
  onPaneCreated: (pane: ManagedPane) => void
  onPaneClosed: (paneId: number) => void
  onActivePaneChange?: (pane: ManagedPane) => void
  terminalOptions: () => ITerminalOptions
  /** WebGL rendering; off falls back to xterm's DOM renderer. */
  gpuAcceleration: () => boolean
  onLinkClick: (event: MouseEvent, url: string) => void
  /** Tooltip of each pane's close button, e.g. with its shortcut. */
  closePaneTitle: string
  /** The close button asks this instead of closing at once, e.g. to confirm a pinned session first. */
  requestClosePane?: (paneId: number) => void
}

export type ManagedPane = {
  id: number
  terminal: Terminal
  container: HTMLElement
}

export type ManagedPaneInternal = ManagedPane & {
  xtermContainer: HTMLElement
  fitAddon: FitAddon
  unicode11Addon: Unicode11Addon
  webLinksAddon: WebLinksAddon
  webglAddon: WebglAddon | null
  webglDisabledAfterContextLoss: boolean
  gpuAcceleration: boolean
  fitResizeObserver: ResizeObserver | null
  pendingFitFrame: number | null
  pointerDownHandler: (() => void) | null
}
