import { expect, test, type Page } from '@playwright/test'
import { cp, readFile, realpath } from 'node:fs/promises'
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

test('Shift Shift opens a new chat on Haiku whose answer links to the code it found', async () => {
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

        // Shift Shift again starts over in a fresh session, from wherever the keys are.
        await editor(page).locator('.view-lines').click()
        await doubleShift(page)
        await expect(chat.getByLabel("Claude's reply")).toHaveCount(0)
        await expect(chat.getByLabel('Model')).toHaveValue('haiku')
        await expect(chat.getByRole('textbox', { name: 'Message' })).toBeFocused()

        await chat.getByRole('button', { name: 'Close Chat' }).click()
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

test('a permission request waits for the user, and Yes lets the tool run', async () => {
  const [, userData, cleanup] = await recordedProject()
  try {
    await withApp(
      async (_app, page) => {
        await expect(page.getByRole('main')).toBeVisible()
        await doubleShift(page)
        const chat = panel(page)
        await expect(chat.getByLabel('Model')).toHaveValue('haiku')
        // Manual mode asks before every change.
        await chat.getByLabel('Mode', { exact: true }).selectOption('default')
        await expect(chat.getByLabel('Mode', { exact: true })).toHaveValue('default')
        const message = chat.getByRole('textbox', { name: 'Message' })
        await message.fill(
          'Create the file notes.txt containing the word hello, with the Write tool.'
        )
        await message.press('Enter')
        const request = chat.getByRole('region', { name: 'Permission request' })
        await expect(request).toContainText('notes.txt')
        await saveScreenshot(page, 'chat-permission')
        await expect(request.getByRole('button')).toHaveText([
          'Yes',
          'Yes, allow all edits during this session',
          'No'
        ])
        await request.getByRole('button', { name: 'Yes', exact: true }).click()
        await expect(request.getByRole('button')).toHaveCount(0)
        await expect(request).toContainText('Yes')
        await expect(chat.getByLabel("Claude's reply")).toContainText('I created')
        await expect(chat.getByRole('button', { name: 'Send (Enter)' })).toBeVisible()
      },
      { userDataDir: userData, env: replaying('permission') }
    )
  } finally {
    await cleanup()
  }
})

test('Stop cancels a running command and the chat takes the next message', async () => {
  const [, userData, cleanup] = await recordedProject()
  try {
    await withApp(
      async (_app, page) => {
        await expect(page.getByRole('main')).toBeVisible()
        await doubleShift(page)
        const chat = panel(page)
        await expect(chat.getByLabel('Model')).toHaveValue('haiku')
        const message = chat.getByRole('textbox', { name: 'Message' })
        await message.fill('Use Bash to run exactly this command: sleep 20; echo finished')
        await message.press('Enter')
        await expect(chat.getByRole('group', { name: /sleep 20/ })).toBeVisible()
        await chat.getByRole('button', { name: 'Stop (Esc)' }).click()
        await expect(chat.getByText('Stopped.')).toBeVisible()
        await expect(chat.getByRole('group', { name: /sleep 20/ })).toContainText('Failed')
        await expect(chat.getByRole('button', { name: 'Send (Enter)' })).toBeVisible()
        await expect(message).toBeEnabled()
      },
      { userDataDir: userData, env: replaying('cancel') }
    )
  } finally {
    await cleanup()
  }
})

test('Generate Workspace Map writes the map file, which Edit Workspace Map opens', async () => {
  const [, userData, cleanup] = await recordedProject()
  try {
    await withApp(
      async (_app, page) => {
        await expect(page.getByRole('main')).toBeVisible()
        await doubleShift(page)
        const chat = panel(page)
        await expect(chat.getByLabel('Model')).toHaveValue('haiku')
        await chat.getByRole('button', { name: 'Generate Workspace Map' }).click()
        await expect(chat.getByText(/^Wrote the workspace map to /)).toBeVisible()
        expect(
          await readFile(join(userData, 'workspaces', 'default.workspace.md'), 'utf8')
        ).toMatch(/^<!-- workspace -->\n#+ Workspace map\n/)
        await chat.getByRole('button', { name: 'Edit Workspace Map' }).click()
        await expect(tab(page, 'default.workspace.md')).toBeVisible()
        await expect(editor(page).locator('.view-lines')).toContainText('Workspace map')
      },
      { userDataDir: userData, env: replaying('map') }
    )
  } finally {
    await cleanup()
  }
})
