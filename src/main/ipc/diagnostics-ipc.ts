import { app, BrowserWindow, powerMonitor } from 'electron'
import { join } from 'node:path'
import { DIAGNOSTICS_CHANNELS } from '../../shared/diagnostics-api'
import { listenForSlowHandlers, requestsInFlight } from '../diagnostics/ipc-in-flight'
import { watchMainStalls } from '../diagnostics/main-stalls'
import {
  PerformanceLog,
  slowHandlerLine,
  slowTaskLine,
  stallLine
} from '../diagnostics/performance-log'
import { type LogFile, openLogFile } from '../logs/log-file'
import { handleTrusted } from './trusted-ipc'

let file: LogFile | null = null
/** Opened on the first line, so a run without freezes doesn't touch the log. */
const performanceLog = new PerformanceLog(
  () => (file ??= openLogFile(join(app.getPath('logs'), 'performance.log')))
)

/** Records slow page frames the renderer reports, and stalls and slow handlers in main itself. */
export function registerDiagnosticsIpc(): void {
  handleTrusted(DIAGNOSTICS_CHANNELS.reportSlowTask, (_event, report) => {
    const line = slowTaskLine(report, new Date())
    if (line === null) throw new Error('Malformed slow task report.')
    performanceLog.write(line)
  })
  listenForSlowHandlers((channel, duration) =>
    performanceLog.write(slowHandlerLine(channel, duration, new Date()))
  )
  // Waking from sleep makes the next tick late without main having been busy.
  let resumed = false
  powerMonitor.on('resume', () => {
    resumed = true
  })
  watchMainStalls((duration) => {
    const afterSleep = resumed
    resumed = false
    // macOS holds timers back for an app in the background (App Nap); only a freeze the user can
    // feel, with one of the app's windows focused, counts.
    if (afterSleep || BrowserWindow.getFocusedWindow() === null) return
    performanceLog.write(stallLine(duration, requestsInFlight(), new Date()))
  })
}
