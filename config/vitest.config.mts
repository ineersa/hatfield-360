import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const root = resolve(import.meta.dirname, '..')

export default defineConfig({
  root,
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Stylesheets load as their text (the app theme tests read them with ?raw); Vitest empties them otherwise.
    css: { include: [/\.css(\?|$)/] },
    // A focused test would silently skip its siblings, locally as well as in CI.
    allowOnly: false
  }
})
