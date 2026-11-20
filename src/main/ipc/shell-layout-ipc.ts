import { SHELL_LAYOUT_CHANNELS } from '../../shared/shell-layout-api'
import { parseShellLayout } from '../window/window-state-document'
import { windowStateStore } from '../window/window-state-store'
import { handleTrusted } from './trusted-ipc'

export function registerShellLayoutIpc(): void {
  handleTrusted(SHELL_LAYOUT_CHANNELS.get, () => windowStateStore.shellLayout())

  handleTrusted(SHELL_LAYOUT_CHANNELS.save, (_event, value) => {
    const layout = parseShellLayout(value)
    if (!layout) throw new Error('Invalid shell layout')
    windowStateStore.saveShellLayout(layout)
  })
}
