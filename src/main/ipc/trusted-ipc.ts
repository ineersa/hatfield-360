import { type IpcMainInvokeEvent, ipcMain } from 'electron'
import { rendererEntryUrl } from '../window/renderer-entry'
import { isTrustedSenderUrl } from './trusted-sender'

/** `ipcMain.handle` that rejects calls from any frame other than the app's own renderer page. */
export function handleTrusted<Args extends unknown[], Result>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Result | Promise<Result>
): void {
  ipcMain.handle(channel, (event, ...args) => {
    const senderUrl = event.senderFrame?.url ?? ''
    if (!isTrustedSenderUrl(senderUrl, rendererEntryUrl())) {
      throw new Error(`Rejected IPC call on ${channel} from untrusted sender`)
    }
    return handler(event, ...(args as Args))
  })
}
