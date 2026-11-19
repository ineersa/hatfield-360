import { session } from 'electron'
import { isTrustedSenderUrl } from '../ipc/trusted-sender'
import { rendererEntryUrl } from './renderer-entry'

/** Web permissions the app's own page may use: listing installed fonts for the font pickers. */
const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['local-fonts'])

function isAllowed(permission: string, requestingUrl: string): boolean {
  return (
    ALLOWED_PERMISSIONS.has(permission) && isTrustedSenderUrl(requestingUrl, rendererEntryUrl())
  )
}

/** Electron grants every web permission by default; the app grants only what it uses, to its own page. */
export function installPermissionPolicy(): void {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) =>
      callback(isAllowed(permission, details.requestingUrl))
  )
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) =>
      isAllowed(permission, details.requestingUrl ?? requestingOrigin)
  )
}
