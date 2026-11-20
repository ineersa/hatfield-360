import { app, clipboard, shell, type BrowserWindow } from 'electron'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { TERMINAL_CHANNELS, type TerminalCommand } from '../../shared/terminal-api'
import {
  gridSize,
  isTerminalId,
  isTerminalInput,
  parseSpawnRequest,
  webLinkUrl
} from '../terminal/terminal-request'
import { terminalSessions } from '../terminal/terminal-sessions'
import { handleTrusted } from './trusted-ipc'

async function existingDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('The terminal folder must be an absolute path.')
  const info = await stat(path).catch(() => null)
  if (!info?.isDirectory()) throw new Error(`The folder ${path} doesn't exist.`)
  return path
}

export function registerTerminalIpc(): void {
  handleTrusted(TERMINAL_CHANNELS.spawn, async (event, value) => {
    const request = parseSpawnRequest(value)
    if (!request) throw new Error('Invalid terminal request.')
    const cwd = await existingDirectory(request.cwd ?? app.getPath('home'))
    return terminalSessions.spawn(event.sender, { cwd, cols: request.cols, rows: request.rows })
  })

  handleTrusted(TERMINAL_CHANNELS.write, (event, id, data) => {
    if (!isTerminalId(id) || !isTerminalInput(data)) throw new Error('Invalid terminal input.')
    terminalSessions.write(event.sender, id, data)
  })

  handleTrusted(TERMINAL_CHANNELS.resize, (event, id, cols, rows) => {
    const size = gridSize(cols, rows)
    if (!isTerminalId(id) || !size) throw new Error('Invalid terminal size.')
    terminalSessions.resize(event.sender, id, size.cols, size.rows)
  })

  handleTrusted(TERMINAL_CHANNELS.ack, (event, id, bytes) => {
    if (!isTerminalId(id) || typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error('Invalid terminal acknowledgement.')
    terminalSessions.acknowledge(event.sender, id, bytes)
  })

  handleTrusted(TERMINAL_CHANNELS.kill, (event, id) => {
    if (!isTerminalId(id)) throw new Error('Invalid terminal.')
    return terminalSessions.kill(event.sender, id)
  })

  handleTrusted(TERMINAL_CHANNELS.openLink, (_event, value) => {
    const url = webLinkUrl(value)
    if (!url) throw new Error('Only http and https links can be opened.')
    return shell.openExternal(url)
  })

  handleTrusted(TERMINAL_CHANNELS.readClipboard, () => clipboard.readText())

  handleTrusted(TERMINAL_CHANNELS.writeClipboard, (_event, text) => {
    if (!isTerminalInput(text)) throw new Error('Invalid clipboard text.')
    return clipboard.writeText(text)
  })
}

/** Runs a Terminal menu item in the window's focused terminal. */
export function sendTerminalCommand(
  window: BrowserWindow | null,
  command: TerminalCommand
): Promise<void> {
  if (!window) return Promise.reject(new Error('No window for the terminal.'))
  window.webContents.send(TERMINAL_CHANNELS.command, command)
  return Promise.resolve()
}
