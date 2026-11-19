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

// Under xvfb a hidden window's first capture can fail or hang until a frame is composited, so each attempt is short.
async function screenshotWhenPainted(page, path) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await page.screenshot({ path, timeout: 1_000 })
    } catch (error) {
      if (attempt >= 20) throw error
      await new Promise((done) => setTimeout(done, 250))
    }
  }
}

const app = await electron.launch({
  args: [root],
  env: { ...process.env, APP_BACKGROUND_LAUNCH: '1' }
})
const logs = []
app.on('console', (message) => logs.push(`[main:${message.type()}] ${message.text()}`))
app.process().stderr?.on('data', (chunk) => logs.push(`[main:stderr] ${chunk}`.trimEnd()))
try {
  const page = await app.firstWindow()
  // The page may have started before these listeners existed; reload so startup output is captured in full, once.
  let reloaded = false
  page.on('console', (message) => {
    if (reloaded) logs.push(`[renderer:${message.type()}] ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    if (reloaded) logs.push(`[renderer:error] ${error.message}`)
  })
  page.once('framenavigated', () => {
    reloaded = true
  })
  await page.reload({ waitUntil: 'load' })
  for (const text of values.click) {
    await page.getByText(text, { exact: true }).click()
  }
  await page.waitForTimeout(250)
  mkdirSync(dirname(values.out), { recursive: true })
  await screenshotWhenPainted(page, values.out)
  console.log('## Accessibility tree\n' + (await page.locator('body').ariaSnapshot()))
  console.log('\n## Logs\n' + (logs.join('\n') || '(none)'))
  console.log(`\n## Screenshot\n${values.out}`)
} finally {
  await app.close()
}
