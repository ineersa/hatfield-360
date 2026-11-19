#!/usr/bin/env node
// Launches the built app hidden, then prints its accessibility tree and console output and saves a screenshot.
// Usage: node .agents/skills/electron-ui-validation/scripts/capture.mjs [--out <png>] [--click <text>]...
import { _electron as electron } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const root = resolve(import.meta.dirname, '../../../..')
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: resolve(root, 'test-results/capture.png') },
    click: { type: 'string', multiple: true, default: [] }
  }
})

const app = await electron.launch({
  args: [root],
  env: { ...process.env, APP_BACKGROUND_LAUNCH: '1' }
})
const logs = []
app.process().stdout?.on('data', (chunk) => logs.push(`[main] ${chunk}`.trimEnd()))
app.process().stderr?.on('data', (chunk) => logs.push(`[main:err] ${chunk}`.trimEnd()))
try {
  const page = await app.firstWindow()
  page.on('console', (message) => logs.push(`[renderer:${message.type()}] ${message.text()}`))
  page.on('pageerror', (error) => logs.push(`[renderer:error] ${error.message}`))
  await page.waitForLoadState('load')
  for (const text of values.click) {
    await page.getByText(text, { exact: true }).click()
  }
  await page.waitForTimeout(250)
  mkdirSync(dirname(values.out), { recursive: true })
  await page.screenshot({ path: values.out })
  console.log('## Accessibility tree\n' + (await page.locator('body').ariaSnapshot()))
  console.log('\n## Logs\n' + (logs.join('\n') || '(none)'))
  console.log(`\n## Screenshot\n${values.out}`)
} finally {
  await app.close()
}
