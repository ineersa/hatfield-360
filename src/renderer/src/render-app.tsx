import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyAppTheme } from './lib/app-theme'
import './assets/main.css'

// Main names the chosen theme in the page URL, so the first paint is already in it.
applyAppTheme(new URLSearchParams(window.location.search).get('theme'))

const root = document.getElementById('root')
if (!root) {
  throw new Error('Missing #root element')
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
