import { connectTerminalWorkspace } from './state/terminal-workspace'
import { connectAgentSessions } from './state/agent-session-store'
import { useWorkspaceStore } from './state/workspace-store'
import { notify } from './state/notification-store'
import { mainErrorMessage } from './lib/main-error-message'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { receiveAgentNotification } from './state/agent-notifications'
import { App } from './App'
import { applyAppTheme } from './lib/app-theme'
import { loadBundledFonts } from './lib/bundled-fonts'
import './assets/main.css'

// Main names the chosen theme in the page URL, so the first paint is already in it.
applyAppTheme(new URLSearchParams(window.location.search).get('theme'))

const root = document.getElementById('root')
if (!root) {
  throw new Error('Missing #root element')
}
const stopAgentNotifications = window.desktop.subscribeAgentNotifications(receiveAgentNotification)
if (import.meta.hot) import.meta.hot.dispose(stopAgentNotifications)

connectAgentSessions()
connectTerminalWorkspace()
const workspace = window.desktop
  .getWorkspace()
  .then(useWorkspaceStore.getState().apply)
  .catch((error: unknown) => {
    notify({
      severity: 'error',
      title: 'Could not restore workspace',
      body: mainErrorMessage(error)
    })
  })
void Promise.all([loadBundledFonts(), workspace]).then(() =>
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
)
