import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: resolve(import.meta.dirname, '../tests/e2e'),
  outputDir: resolve(import.meta.dirname, '../test-results'),
  timeout: 60_000,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list'
})
