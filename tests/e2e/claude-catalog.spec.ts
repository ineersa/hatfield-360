import { expect, test } from '@playwright/test'
import { mkdir, utimes, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { git, makeRepo } from './git-repository'
import { withApp } from './launch-app'
import { CLIPBOARD_TAG, keepUserClipboard } from './user-clipboard'
import { seedWorkspace } from './workspace-seed'

const sessionId = (index: number) => `abcdef01-1234-4234-8234-${String(index).padStart(12, '0')}`

async function writeSession(
  config: string,
  cwd: string,
  index: number,
  title: string,
  mtime: number
) {
  const directory = join(config, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))
  await mkdir(directory, { recursive: true })
  const id = sessionId(index)
  const file = join(directory, `${id}.jsonl`)
  const rows = [
    {
      type: 'user',
      isSidechain: false,
      sessionId: id,
      cwd,
      timestamp: new Date(mtime).toISOString(),
      uuid: '12345678-1234-4234-8234-123456789abc',
      message: { role: 'user', content: 'original prompt' }
    },
    { type: 'custom-title', sessionId: id, customTitle: title }
  ]
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
  const date = new Date(mtime)
  await utimes(file, date, date)
}

test(
  'first launch lists scoped Claude sessions and resumes them through Settings',
  { tag: CLIPBOARD_TAG },
  async () => {
    const info = test.info()
    const { projects, repo, cleanup } = await makeRepo()
    const folder = join(projects, 'ordinary-folder')
    const other = join(projects, 'outside-workspace')
    const worktree = join(projects, 'linked-tree')
    const config = join(projects, 'claude-config')
    try {
      await mkdir(folder)
      await mkdir(other)
      git(repo, 'worktree', 'add', '-b', 'linked', worktree)
      const now = Date.now()
      await Promise.all([
        ...Array.from({ length: 27 }, (_, index) => {
          const number = index + 1
          return writeSession(
            config,
            number === 2 ? worktree : repo,
            number,
            `Conversation ${number}`,
            now - number * 60_000
          )
        }),
        writeSession(config, repo, 28, 'Expired session', now - 15 * 86_400_000),
        writeSession(config, folder, 29, 'Ordinary folder session', now - 60_000),
        writeSession(config, other, 30, 'Unrelated session', now - 60_000)
      ])
      const [userDataDir, cleanUserData] = await seedWorkspace([
        { path: repo, kind: 'project' },
        { path: folder, kind: 'folder' }
      ])
      try {
        await writeFile(
          join(userDataDir, 'settings.json'),
          JSON.stringify({
            'terminal.gpuAcceleration': false,
            'agents.claude': {
              executable: process.execPath,
              args: [
                resolve(__dirname, 'fixtures/agent-scenario.mjs'),
                'claude',
                sessionId(3),
                'catalog-resume'
              ]
            }
          })
        )
        await withApp(
          async (app, page) => {
            const restoreClipboard = await keepUserClipboard(app)
            try {
              const recent = page.getByRole('button', { name: 'Recent 27', exact: true })
              await expect(recent).toHaveAttribute('aria-expanded', 'false')
              await expect(page.getByRole('tab')).toHaveCount(0)
              await recent.click()
              const group = page.getByRole('list', { name: 'app recent sessions' })
              const rows = group.getByRole('button', { name: /^Resume Conversation / })
              const row = (number: number) =>
                group.getByRole('button', { name: `Resume Conversation ${number}`, exact: true })
              await expect(rows).toHaveCount(5)
              await expect(rows.first()).toHaveAccessibleName('Resume Conversation 1')
              await expect(rows.last()).toHaveAccessibleName('Resume Conversation 5')
              await info.attach('first-page', {
                body: await group.ariaSnapshot(),
                contentType: 'text/plain'
              })
              await group.getByRole('button', { name: 'Show 20 more' }).click()
              await expect(rows).toHaveCount(25)
              await group.getByRole('button', { name: 'Show 2 more' }).click()
              await expect(rows).toHaveCount(27)
              await expect(row(27)).toBeVisible()
              await expect(group.getByText('Older than 14 days: search memory')).toBeVisible()
              await expect(page.getByRole('button', { name: /^Recent \d+$/ })).toHaveCount(1)
              await expect(
                page.getByRole('button', {
                  name: /Expired session|Ordinary folder session|Unrelated session/
                })
              ).toHaveCount(0)

              await row(1).click({ button: 'right' })
              const menu = page.getByRole('menu')
              await expect(menu.getByRole('menuitem')).toHaveText([
                'Resume',
                'Resume in Split',
                'Copy session ID'
              ])
              await info.attach('recent-actions', {
                body: await menu.ariaSnapshot(),
                contentType: 'text/plain'
              })
              await menu.getByRole('menuitem', { name: 'Copy session ID' }).click()
              expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(sessionId(1))

              await row(1).click({ button: 'right' })
              await menu.getByRole('menuitem', { name: 'Resume', exact: true }).click()
              const live = (suffix: string) =>
                page.getByRole('button', { name: new RegExp(`^Claude .*Catalog resume ${suffix}`) })
              const panes = page.getByRole('tabpanel').getByTestId('terminal-pane')
              await expect(live('001')).toBeVisible()
              await expect(page.getByRole('tab')).toHaveCount(1)
              await expect(panes).toHaveCount(1)

              await row(2).click({ button: 'right' })
              await menu.getByRole('menuitem', { name: 'Resume in Split' }).click()
              await expect(live('002')).toBeVisible()
              await expect(page.getByRole('tab')).toHaveCount(1)
              await expect(panes).toHaveCount(2)
              await expect(panes.nth(1).locator('.xterm-rows')).toContainText(
                `Directory: ${worktree}`
              )
              await info.attach('split', {
                body: await page.getByRole('list', { name: 'Workspace folders' }).ariaSnapshot(),
                contentType: 'text/plain'
              })

              await row(3).click()
              await expect(
                page.getByRole('alert').filter({
                  hasText: `Expected conversation ${sessionId(3)}, but the agent reported ffffffff-ffff-4fff-8fff-ffffffffffff.`
                })
              ).toBeVisible()
              await expect(live('003')).toHaveCount(0)
            } finally {
              await restoreClipboard()
            }
          },
          { userDataDir, env: { CLAUDE_CONFIG_DIR: config } }
        )
      } finally {
        await cleanUserData()
      }
    } finally {
      await cleanup()
    }
  }
)
