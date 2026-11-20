import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const root = resolve(import.meta.dirname, '..')

export default defineConfig({
  root,
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mts'],
    // A focused test would silently skip its siblings, locally as well as in CI.
    allowOnly: false
  }
})
