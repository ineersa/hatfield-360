import { expect, test, type Locator, type Page } from '@playwright/test'
import { cp, readFile, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { editor, tab } from './editor-page'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'
import { seedWorkspace } from './workspace-seed'

const fixtures = resolve(__dirname, '..', 'fixtures', 'acp')

/** What the links cassette sends, as scripts/record-chat-cassettes.ts recorded it. */
const linksPrompt = (repo: string): string =>
  [
    'Without using any tools, reply with exactly this text and nothing else:',
    '',
    `The greeting is in src/greeting.js:2:10 and is called from __src/main.js:1, 3__; the readme is **README.md**, see also \`src/greeting.js#L2-L3\` and [its last line](<${repo}/src/greeting.js#L3>). There is no src/missing.js:4.`
  ].join('\n')

const panel = (page: Page) => page.getByRole('complementary', { name: 'Chat panel' })

/** A config picker in the chat, by its label: Mode, Model or Effort. */
const picker = (chat: Locator, label: string) =>
  chat.getByRole('combobox', { name: label, exact: true })

/** New Chat's key, from wherever the keys are. */
async function newChatKey(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+Shift+KeyL')
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

test('Ctrl/Cmd+Shift+L opens a new chat on Haiku whose answer links to the code it found', async () => {
  const [, userData, cleanup] = await recordedProject()
  try {
    await withApp(
      async (_app, page) => {
        await expect(page.getByRole('main')).toBeVisible()
        await newChatKey(page)
        const chat = panel(page)
        await expect(chat).toBeVisible()
        // The chat starts on the cheap defaults, in auto mode.
        await expect(picker(chat, 'Model')).toHaveText('Haiku 5.5')
        await expect(picker(chat, 'Effort')).toHaveText('Medium')
        await expect(picker(chat, 'Mode')).toHaveText('Auto')

        const message = chat.getByRole('textbox', { name: 'Message' })
        await expect(message).toBeFocused()
        await message.fill(
          'Where is the greeting implemented? Reply in one sentence with a path:line reference.'
        )
        await message.press('Enter')
        await expect(chat.getByLabel('Your message')).toContainText('Where is the greeting')
        const reply = chat.getByLabel("Claude's reply")
        await expect(reply).toContainText('is called from')
        await expect(chat.getByRole('group', { name: /^Tool: / })).toContainText('Completed')
        await expect(chat.getByRole('button', { name: 'Send (Enter)' })).toBeVisible()
        await saveScreenshot(page, 'chat-answer')

        // The reference opens the file at its line.
        await reply.getByRole('button', { name: 'src/greeting.js:2' }).click()
        await expect(tab(page, 'greeting.js')).toBeVisible()
        await expect(editor(page).locator('.line-numbers.active-line-number')).toHaveText('2')

        // The key again starts over in a fresh session, from wherever the keys are.
        await editor(page).locator('.view-lines').click()
        await newChatKey(page)
        await expect(chat.getByLabel("Claude's reply")).toHaveCount(0)
        await expect(picker(chat, 'Model')).toHaveText('Haiku 5.5')
        await expect(chat.getByRole('textbox', { name: 'Message' })).toBeFocused()

        // The Chat button under the notifications bell shows the panel is open, and closes it.
        const chatButton = page
          .getByRole('navigation', { name: 'Tool windows' })
          .getByRole('button', { name: 'Chat' })
        await expect(chatButton).toHaveAttribute('aria-pressed', 'true')
        await chatButton.click()
        await expect(chat).toBeHidden()
        await expect(chatButton).toHaveAttribute('aria-pressed', 'false')
      },
      { userDataDir: userData, env: replaying('answer') }
    )
  } finally {
    await cleanup()
  }
})

test('every file a reply names opens the editor at its line, and a missing one stays text', async () => {
  const [repo, userData, cleanup] = await recordedProject()
  try {
    await withApp(
      async (_app, page) => {
        await expect(page.getByRole('main')).toBeVisible()
        await newChatKey(page)
        const chat = panel(page)
        const message = chat.getByRole('textbox', { name: 'Message' })
        await expect(picker(chat, 'Model')).toHaveText('Haiku 5.5')
        await message.fill(linksPrompt(repo))
        await message.press('Enter')
        const reply = chat.getByLabel("Claude's reply")
        await expect(reply).toContainText('There is no src/missing.js:4.')
        await expect(chat.getByRole('button', { name: 'Send (Enter)' })).toBeVisible()
        const link = (name: string) => reply.getByRole('button', { name, exact: true })
        await expect(link('README.md')).toBeVisible()
        await saveScreenshot(page, 'chat-links')
        // Resolved together: once one is a link, a path that isn't in the workspace never becomes one.
        await expect(link('src/missing.js:4')).toHaveCount(0)

        // The status bar's caret, `line:column`, says where each link put the editor.
        const caret = page.getByRole('status', { name: 'Caret position' })
        await link('src/greeting.js:2:10').click()
        await expect(tab(page, 'greeting.js')).toBeVisible()
        await expect(caret).toHaveText('2:10')

        await link('src/main.js:1, 3').click()
        await expect(tab(page, 'main.js')).toHaveAttribute('aria-selected', 'true')
        await expect(caret).toHaveText('1:1')

        await link('src/greeting.js#L2-L3').click()
        await expect(tab(page, 'greeting.js')).toHaveAttribute('aria-selected', 'true')
        await expect(caret).toHaveText('2:1')

        await link('README.md').click()
        await expect(tab(page, 'README.md')).toHaveAttribute('aria-selected', 'true')
        await expect(caret).toHaveText('1:1')

        // A Markdown link to an absolute path in the project opens it too.
        await reply.getByRole('link', { name: 'its last line' }).click()
        await expect(tab(page, 'greeting.js')).toHaveAttribute('aria-selected', 'true')
        await expect(caret).toHaveText('3:1')
      },
      { userDataDir: userData, env: replaying('links') }
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
        await newChatKey(page)
        const chat = panel(page)
        const message = chat.getByRole('textbox', { name: 'Message' })
        await expect(picker(chat, 'Model')).toHaveText('Haiku 5.5')
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
        await newChatKey(page)
        const chat = panel(page)
        await expect(picker(chat, 'Model')).toHaveText('Haiku 5.5')
        // Manual mode asks before every change.
        await picker(chat, 'Mode').click()
        await page.getByRole('option', { name: 'Manual' }).click()
        await expect(picker(chat, 'Mode')).toHaveText('Manual')
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
        await expect(chat.getByLabel("Claude's reply")).toContainText('Created')
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
        await newChatKey(page)
        const chat = panel(page)
        await expect(picker(chat, 'Model')).toHaveText('Haiku 5.5')
        const message = chat.getByRole('textbox', { name: 'Message' })
        await message.fill('Use Bash to run exactly this command: sleep 20; echo finished')
        await message.press('Enter')
        await expect(chat.getByRole('group', { name: /sleep 20/ })).toBeVisible()
        await chat.getByRole('button', { name: 'Stop (Esc)' }).click()
        await expect(chat.getByText('Stopped.')).toBeVisible()
        await expect(chat.getByRole('group', { name: /sleep 20/ })).toContainText('Error')
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
        await newChatKey(page)
        const chat = panel(page)
        await expect(picker(chat, 'Model')).toHaveText('Haiku 5.5')
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
