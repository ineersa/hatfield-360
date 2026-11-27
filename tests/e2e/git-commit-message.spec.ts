import { expect, test, type Page } from '@playwright/test'
import { cp, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseCassette, serializeCassette } from '../fixtures/acp/cassette.mjs'
import {
  COMMIT_MESSAGE_INSTRUCTIONS,
  COMMIT_MESSAGE_PATH,
  makeCommitMessageRepo
} from '../fixtures/acp/commit-message-repo.mjs'
import { changes, showGit } from './git-repository'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'
import { seedWorkspace } from './workspace-seed'

const fixtures = resolve(__dirname, '..', 'fixtures', 'acp')

/** What the cassette's agent answered, as scripts/record-chat-cassettes.ts recorded it. */
const RECORDED_MESSAGE = 'greeting: Change greeting text to "Welcome back"'

const include = (page: Page) =>
  changes(page).getByRole('checkbox', { name: `Include ${COMMIT_MESSAGE_PATH}`, exact: true })
const message = (page: Page) => page.getByRole('textbox', { name: 'Commit message' })
const generate = (page: Page) => page.getByRole('button', { name: 'Generate Commit Message' })
const stop = (page: Page) => page.getByRole('button', { name: 'Stop Generating' })
const commitButton = (page: Page) => page.getByRole('button', { name: 'Commit', exact: true })

/**
 * The repository the commit-message cassette was recorded in, as the workspace's only project,
 * with the rules from the recording in Settings. `cassette` is what stands in for the agent.
 */
async function withCommitMessageApp(
  cassette: string,
  body: (page: Page) => Promise<void>
): Promise<void> {
  const [dir, cleanProject] = await makeTempDir('commit-message')
  const repo = join(await realpath(dir), 'repo')
  await cp(join(fixtures, 'repo'), repo, { recursive: true })
  makeCommitMessageRepo(repo)
  const [userData, cleanUserData] = await seedWorkspace([{ path: repo, kind: 'project' }])
  await writeFile(
    join(userData, 'settings.json'),
    JSON.stringify({
      'terminal.gpuAcceleration': false,
      'git.commitMessage.instructions': COMMIT_MESSAGE_INSTRUCTIONS
    })
  )
  try {
    await withApp(async (_app, page) => body(page), {
      userDataDir: userData,
      env: {
        HATFIELD_CHAT_AGENT_SCRIPT: join(fixtures, 'acp-replayer.mjs'),
        HATFIELD_CHAT_CASSETTE: cassette
      }
    })
  } finally {
    await cleanUserData()
    await cleanProject()
  }
}

test('Generate writes the checked files’ commit message with the agent, which reads a diff it asks for', async () => {
  await withCommitMessageApp(join(fixtures, 'commit-message.jsonl'), async (page) => {
    await showGit(page)
    // Nothing checked: nothing to describe, and the button says so.
    await expect(generate(page)).toHaveAttribute('aria-disabled', 'true')
    await include(page).click()
    await expect(generate(page)).not.toHaveAttribute('aria-disabled')
    await message(page).fill('wip')
    // The replay answers only the prompt the recording got: the checked file's name and counts,
    // the recent subject, the rules from Settings, then the diff the agent asked for.
    await generate(page).click()
    await expect(message(page)).toHaveValue(RECORDED_MESSAGE)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(commitButton(page)).not.toHaveAttribute('aria-disabled')
    await saveScreenshot(page, 'git-commit-message')
    // What the user had typed comes back on request.
    await page.getByRole('button', { name: 'Restore Previous Message' }).click()
    await expect(message(page)).toHaveValue('wip')
    await expect(page.getByRole('button', { name: 'Restore Previous Message' })).toHaveCount(0)
  })
})

test('Stop Generating ends the wait and leaves the message box as it was', async () => {
  // The recording up to the prompt: the agent never answers, so only Stop ends the wait.
  const [dir, clean] = await makeTempDir('hanging-cassette')
  const recorded = parseCassette(await readFile(join(fixtures, 'commit-message.jsonl'), 'utf8'))
  const prompt = recorded.entries.findIndex(
    (entry) =>
      typeof entry.message === 'object' &&
      entry.message !== null &&
      'method' in entry.message &&
      entry.message.method === 'session/prompt'
  )
  expect(prompt).toBeGreaterThan(0)
  const cassette = join(dir, 'hanging.jsonl')
  await writeFile(
    cassette,
    serializeCassette(recorded.header, recorded.entries.slice(0, prompt + 1))
  )
  try {
    await withCommitMessageApp(cassette, async (page) => {
      await showGit(page)
      await include(page).click()
      await message(page).fill('my own words')
      await generate(page).click()
      await expect(message(page)).toHaveAttribute('aria-busy', 'true')
      await expect(message(page)).toHaveAttribute('readonly')
      await expect(commitButton(page)).toHaveAttribute('aria-disabled', 'true')
      await stop(page).click()
      await expect(generate(page)).toBeVisible()
      await expect(message(page)).toHaveValue('my own words')
      await expect(message(page)).not.toHaveAttribute('readonly')
      await expect(page.getByRole('alert')).toHaveCount(0)
    })
  } finally {
    await clean()
  }
})

test('an agent that fails to start shows why in the panel and keeps the message', async () => {
  await withCommitMessageApp(join(fixtures, 'no-such-cassette.jsonl'), async (page) => {
    await showGit(page)
    await include(page).click()
    await message(page).fill('my own words')
    await generate(page).click()
    const failure = page.getByRole('alert')
    await expect(failure).toContainText('Generating the commit message failed')
    // The agent's exit and what it printed.
    await expect(failure).toContainText('The agent exited')
    await expect(failure).toContainText('no-such-cassette.jsonl')
    await expect(message(page)).toHaveValue('my own words')
  })
})
