import { mainErrorMessage } from '@/lib/main-error-message'
import { notify } from '@/state/notification-store'

/** Opens a link in a terminal on Ctrl/Cmd+click, as in VS Code, so selecting text across it doesn't. */
export function openTerminalLink(event: MouseEvent, url: string): void {
  if (!event.ctrlKey && !event.metaKey) return
  void window.desktop.openWebLink(url).catch((error: unknown) =>
    notify({
      severity: 'error',
      title: 'Could not open terminal link',
      body: mainErrorMessage(error)
    })
  )
}
