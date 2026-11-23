import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: resolve(import.meta.dirname, '../tests/e2e'),
  outputDir: resolve(import.meta.dirname, '../test-results'),
  // Each test launches its own app with its own data folder, so tests run side by side.
  fullyParallel: true,
  workers: '50%',
  timeout: 30_000,
  forbidOnly: true,
  reporter: process.env.CI ? 'github' : 'list',
  projects: [
    { name: 'app', grepInvert: /@clipboard/ },
    // The system clipboard is one per display: tests that use it take turns.
    { name: 'clipboard', grep: /@clipboard/, workers: 1 }
  ]
})
