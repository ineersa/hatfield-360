import { expect, test, type Page } from '@playwright/test'
import { cp, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { editor, tab } from './editor-page'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'
import { seedWorkspace } from './workspace-seed'

const fixtures = resolve(__dirname, '..', 'fixtures', 'acp')

const panel = (page: Page) => page.getByRole('complementary', { name: 'Chat panel' })

/** Shift pressed twice on its own, as JetBrains opens Search Everywhere. */
async function doubleShift(page: Page): Promise<void> {
  await page.keyboard.press('Shift')
  await page.keyboard.press('Shift')
}

/** A copy of the project the cassettes were recorded in, as the workspace's only folder. */
async function recordedProject(): Promise<[string, string, () => Promise<void>]> {
  const [dir, cleanProject] = await makeTempDir('chat')
  const repo = join(await realpath(dir), 'repo')
  await cp(join(fixtures, 'repo'), repo, { recursive: true })
  const [userData, cleanUserData] = await seedWorkspace([{ path: repo, kind: 'folder' }])
  return [
    repo,
    userData,
    async () => {
      await cleanUserData()
      await cleanProject()
    }
  ]
}

const replaying = (cassette: string) => ({
  HATFIELD_CHAT_AGENT_SCRIPT: join(fixtures, 'acp-replayer.mjs'),
  HATFIELD_CHAT_CASSETTE: join(fixtures, `${cassette}.jsonl`)
})

test('Shift Shift opens a chat on Haiku whose answer links to the code it found', async () => {
  const [, userData, cleanup] = await recordedProject()
  try {
    await withApp(
      async (_app, page) => {
        await expect(page.getByRole('main')).toBeVisible()
        await doubleShift(page)
        const chat = panel(page)
        await expect(chat).toBeVisible()
        // The chat starts on the cheap defaults, in auto mode.
        await expect(chat.getByLabel('Model')).toHaveValue('haiku')
        await expect(chat.getByLabel('Effort')).toHaveValue('medium')
        await expect(chat.getByLabel('Mode', { exact: true })).toHaveValue('auto')

        const message = chat.getByRole('textbox', { name: 'Message' })
        await expect(message).toBeFocused()
        await message.fill(
          'Where is the greeting implemented? Reply in one sentence with a path:line reference.'
        )
        await message.press('Enter')
        await expect(chat.getByLabel('Your message')).toContainText('Where is the greeting')
        const reply = chat.getByLabel("Claude's reply")
        await expect(reply).toContainText('which returns')
        await expect(chat.getByRole('group', { name: /^Tool: / })).toContainText('Done')
        await expect(chat.getByRole('button', { name: 'Send (Enter)' })).toBeVisible()
        await saveScreenshot(page, 'chat-answer')

        // The reference opens the file at its line.
        await reply.getByRole('button', { name: 'src/greeting.js:2' }).click()
        await expect(tab(page, 'greeting.js')).toBeVisible()
        await expect(editor(page).locator('.line-numbers.active-line-number')).toHaveText('2')

        // New Chat starts over in a fresh session.
        await chat.getByRole('button', { name: 'New Chat' }).click()
        await expect(chat.getByLabel("Claude's reply")).toHaveCount(0)
        await expect(chat.getByLabel('Model')).toHaveValue('haiku')

        await chat.getByRole('textbox', { name: 'Message' }).focus()
        await doubleShift(page)
        await expect(chat).toBeHidden()
      },
      { userDataDir: userData, env: replaying('answer') }
    )
  } finally {
    await cleanup()
  }
})

test('the chat shows why the agent stopped when it fails', async () => {
  const [, userData, cleanup] = await recordedProject()
  try {
    await withApp(
      async (_app, page) => {
        await expect(page.getByRole('main')).toBeVisible()
        await doubleShift(page)
        const chat = panel(page)
        const message = chat.getByRole('textbox', { name: 'Message' })
        await expect(chat.getByLabel('Model')).toHaveValue('haiku')
        // The recording expects another prompt: the replayer exits with what it expected.
        await message.fill('Something the recording never saw')
        await message.press('Enter')
        await expect(chat.getByRole('alert').first()).toContainText("doesn't match the client")
        await expect(chat).toContainText('The chat ended.')
        await expect(message).toBeDisabled()
      },
      { userDataDir: userData, env: replaying('answer') }
    )
  } finally {
    await cleanup()
  }
})
