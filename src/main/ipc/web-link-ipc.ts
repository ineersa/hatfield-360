import { shell } from 'electron'
import { WEB_LINK_CHANNELS } from '../../shared/web-link-api'
import { webLinkUrl } from '../web-link/web-link-url'
import { handleTrusted } from './trusted-ipc'

export function registerWebLinkIpc(): void {
  handleTrusted(WEB_LINK_CHANNELS.open, (_event, value) => {
    const url = webLinkUrl(value)
    if (!url) throw new Error('Only http and https links can be opened.')
    return shell.openExternal(url)
  })
}
