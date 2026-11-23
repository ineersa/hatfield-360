import { importWithRetry } from './lib/module-load-retry'

// The app's modules load through a retry: one dropped request would otherwise leave a blank window.
importWithRetry(() => import('./render-app')).catch((error: unknown) => {
  console.error('The app failed to load', error)
  const message = document.createElement('p')
  message.setAttribute('role', 'alert')
  message.textContent = `Hatfield 360 couldn't load: ${error instanceof Error ? error.message : String(error)}. Restart the app to try again.`
  document.getElementById('root')?.replaceChildren(message)
})
