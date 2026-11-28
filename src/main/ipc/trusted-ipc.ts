import { type IpcMainInvokeEvent, ipcMain } from 'electron'
import { trackRequest } from '../diagnostics/ipc-in-flight'
import { rendererEntryUrl } from '../window/renderer-entry'
import { isTrustedSenderUrl } from './trusted-sender'

/** Arguments arrive from the renderer unvalidated, so handlers receive `unknown` and must check them. */
type TrustedHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

/** `ipcMain.handle` that rejects calls from any frame other than the app's own renderer page. */
export function handleTrusted(channel: string, handler: TrustedHandler): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    const senderUrl = event.senderFrame?.url ?? ''
    if (!isTrustedSenderUrl(senderUrl, rendererEntryUrl())) {
      throw new Error(`Rejected IPC call on ${channel} from untrusted sender`)
    }
    return trackRequest(channel, () => handler(event, ...args))
  })
}
