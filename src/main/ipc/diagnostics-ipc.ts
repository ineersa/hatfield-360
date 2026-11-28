import { app } from 'electron'
import { join } from 'node:path'
import { DIAGNOSTICS_CHANNELS } from '../../shared/diagnostics-api'
import { requestsInFlight } from '../diagnostics/ipc-in-flight'
import { watchMainStalls } from '../diagnostics/main-stalls'
import { PerformanceLog, slowTaskLine, stallLine } from '../diagnostics/performance-log'
import { type LogFile, openLogFile } from '../logs/log-file'
import { handleTrusted } from './trusted-ipc'

let file: LogFile | null = null
/** Opened on the first line, so a run without freezes doesn't touch the log. */
const performanceLog = new PerformanceLog(
  () => (file ??= openLogFile(join(app.getPath('logs'), 'performance.log')))
)

/** Records slow page frames the renderer reports and stalls of main's own event loop. */
export function registerDiagnosticsIpc(): void {
  handleTrusted(DIAGNOSTICS_CHANNELS.reportSlowTask, (_event, report) => {
    const line = slowTaskLine(report, new Date())
    if (line === null) throw new Error('Malformed slow task report.')
    performanceLog.write(line)
  })
  watchMainStalls((duration) =>
    performanceLog.write(stallLine(duration, requestsInFlight(), new Date()))
  )
}
