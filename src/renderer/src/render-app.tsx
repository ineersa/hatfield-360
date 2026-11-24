import { initializeTerminalWorkspace } from './state/terminal-workspace'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { receiveAgentNotification } from './state/agent-notifications'
import { App } from './App'
import { applyAppTheme } from './lib/app-theme'
import './assets/main.css'

// Main names the chosen theme in the page URL, so the first paint is already in it.
applyAppTheme(new URLSearchParams(window.location.search).get('theme'))

const root = document.getElementById('root')
if (!root) {
  throw new Error('Missing #root element')
}
const stopAgentNotifications = window.desktop.subscribeAgentNotifications(receiveAgentNotification)
if (import.meta.hot) import.meta.hot.dispose(stopAgentNotifications)

const appRoot = createRoot(root)
void initializeTerminalWorkspace()
  .catch((error: unknown) => console.error('Loading terminal workspace failed:', error))
  .then(() =>
    appRoot.render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  )
