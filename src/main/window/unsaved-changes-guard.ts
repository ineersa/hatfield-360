import { app, BrowserWindow, type WebContents } from 'electron'
import { EDITOR_CHANNELS } from '../../shared/editor-api'

/** Windows whose editor has unsaved changes, as their pages report. */
const unsaved = new Set<WebContents>()
/** A quit is waiting for the windows' answers; otherwise an answer closes just its window. */
let quitAsked = false

export function setUnsaved(contents: WebContents, value: boolean): void {
  if (value) unsaved.add(contents)
  else unsaved.delete(contents)
}

const ask = (window: BrowserWindow): void => window.webContents.send(EDITOR_CHANNELS.closeRequested)

/** Closing a window with unsaved changes asks its page first. */
export function guardUnsavedChanges(window: BrowserWindow): void {
  const contents = window.webContents
  window.on('close', (event) => {
    if (!unsaved.has(contents)) return
    event.preventDefault()
    ask(window)
  })
  window.on('closed', () => unsaved.delete(contents))
}

/** Asks the windows with unsaved changes before quitting; true when the quit has to wait for them. */
export function quitWaitsForUnsavedChanges(): boolean {
  const windows = BrowserWindow.getAllWindows().filter(
    (window) => !window.isDestroyed() && unsaved.has(window.webContents)
  )
  if (windows.length === 0) return false
  quitAsked = true
  for (const window of windows) ask(window)
  return true
}

/** The page's answer: its changes were saved or discarded, or the close was cancelled. */
export function answerClose(contents: WebContents, proceed: boolean): void {
  if (!proceed) {
    quitAsked = false
    return
  }
  unsaved.delete(contents)
  if (quitAsked) {
    if (unsaved.size === 0) app.quit()
    return
  }
  BrowserWindow.fromWebContents(contents)?.close()
}
