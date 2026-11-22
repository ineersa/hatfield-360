/** A new shell in a pty. Without `cwd` it starts in the user's home folder. */
type TerminalSpawnRequest = { cwd?: string; cols: number; rows: number }

export type TerminalSession = { id: string; pid: number; shell: string }

export type TerminalExit = { id: string; exitCode: number; signal: number | null }

/** Terminal menu items and shortcuts, run by the renderer against the focused terminal. */
export const TERMINAL_COMMANDS = [
  'new-terminal',
  'split-right',
  'split-down',
  'close-pane',
  'focus-next-pane',
  'focus-previous-pane',
  'next-tab',
  'previous-tab'
] as const
export type TerminalCommand = (typeof TERMINAL_COMMANDS)[number]

/** Grid sizes are capped so a bogus request can't make the pty allocate a huge screen. */
export const TERMINAL_GRID_LIMIT = { cols: 2000, rows: 1000 } as const

export const TERMINAL_CHANNELS = {
  spawn: 'terminal:spawn',
  write: 'terminal:write',
  resize: 'terminal:resize',
  kill: 'terminal:kill',
  ack: 'terminal:ack',
  readClipboard: 'terminal:read-clipboard',
  writeClipboard: 'terminal:write-clipboard',
  data: 'terminal:data',
  exit: 'terminal:exit',
  command: 'terminal:command'
} as const

export type TerminalApi = {
  spawnTerminal: (request: TerminalSpawnRequest) => Promise<TerminalSession>
  writeTerminal: (id: string, data: string) => Promise<void>
  resizeTerminal: (id: string, cols: number, rows: number) => Promise<void>
  killTerminal: (id: string) => Promise<void>
  /** Tells main the page has drawn `bytes` (string length) of the terminal's output: flow control. */
  ackTerminalOutput: (id: string, bytes: number) => Promise<void>
  /** The clipboard's text for a terminal paste; '' when it holds none (an image, say). */
  readTerminalClipboard: () => Promise<string>
  /** Puts a terminal selection on the clipboard. */
  writeTerminalClipboard: (text: string) => Promise<void>
  subscribeTerminalData: (callback: (id: string, data: string) => void) => () => void
  subscribeTerminalExit: (callback: (exit: TerminalExit) => void) => () => void
  subscribeTerminalCommand: (callback: (command: TerminalCommand) => void) => () => void
}
