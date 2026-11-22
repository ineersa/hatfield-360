import { expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { editor, lines, openFile, showView, tab, tabs, typeAtEnd } from './editor-page'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'
import { seedWorkspace } from './workspace-seed'

const NUMBERED = ['one', 'two', 'three', 'four', 'five'].join('\n') + '\n'

/** A folder `app` in the workspace, with the files the test writes into it. */
async function withProject(
  files: Record<string, string | Buffer>,
  run: (page: Page, app: string) => Promise<void>
): Promise<void> {
  const [dir, cleanDir] = await makeTempDir('editor-disk')
  const app = join(await realpath(dir), 'app')
  await mkdir(app)
  for (const [name, contents] of Object.entries(files)) {
    await mkdir(dirname(join(app, name)), { recursive: true })
    await writeFile(join(app, name), contents)
  }
  const [userData, cleanUserData] = await seedWorkspace([{ path: app, kind: 'folder' }])
  try {
    await withApp(
      async (_app, page) => {
        await showView(page, 'Files')
        await run(page, app)
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanDir()
  }
}

const changedDialog = (page: Page) => page.getByRole('alertdialog')
const activeLine = (page: Page) => editor(page).locator('.line-numbers.active-line-number')

test('an open file follows its changes on disk, and unsaved edits ask which version stays', async () => {
  await withProject({ 'notes.txt': NUMBERED }, async (page, app) => {
    const notes = join(app, 'notes.txt')
    await openFile(page, 'app', 'notes.txt')
    await expect(lines(page)).toContainText('five')
    // The caret on line 4 stays there when line 1 changes above it.
    await lines(page).getByText('four', { exact: true }).click()
    await expect(activeLine(page)).toHaveText('4')

    await writeFile(notes, NUMBERED.replace('one', 'ONE from disk'))
    await expect(lines(page)).toContainText('ONE from disk')
    await expect(tab(page, 'notes.txt')).toBeVisible()
    await expect(activeLine(page)).toHaveText('4')

    // Keep My Version: the next save overwrites the disk without asking.
    await typeAtEnd(page, 'mine')
    await expect(tab(page, 'notes.txt, unsaved')).toBeVisible()
    await writeFile(notes, 'theirs\n')
    await expect(changedDialog(page)).toContainText('notes.txt changed on disk')
    await saveScreenshot(page, 'editor-changed-on-disk')
    await changedDialog(page).getByRole('button', { name: 'Keep My Version' }).click()
    await expect(changedDialog(page)).toBeHidden()
    await expect(lines(page)).toContainText('mine')
    expect(await readFile(notes, 'utf8')).toBe('theirs\n')
    await lines(page).click()
    await page.keyboard.press('ControlOrMeta+S')
    await expect(tab(page, 'notes.txt')).toBeVisible()
    expect(await readFile(notes, 'utf8')).toContain('mine')
    await expect(changedDialog(page)).toBeHidden()

    // Load Disk Version: the edits go, the tab shows the file.
    await typeAtEnd(page, ' again')
    await writeFile(notes, 'theirs again\n')
    await changedDialog(page).getByRole('button', { name: 'Load Disk Version' }).click()
    await expect(lines(page)).toHaveText('theirs again')
    await expect(tab(page, 'notes.txt')).toBeVisible()
    expect(await readFile(notes, 'utf8')).toBe('theirs again\n')
  })
})

test('main refuses a save based on a version the file no longer has', async () => {
  await withProject({ 'notes.txt': 'first\n' }, async (page, app) => {
    const notes = join(app, 'notes.txt')
    await openFile(page, 'app', 'notes.txt')
    await expect(lines(page)).toContainText('first')
    // The page asks main directly. (A script string: the tests are typed for Node, without the DOM.)
    const write = (base: string) =>
      page.evaluate<string>(
        `window.desktop.writeTextFile(${JSON.stringify(notes)}, 'written', ${base}).then((result) => result.status)`
      )
    expect(await write("'not-the-version-on-disk'")).toBe('changed')
    expect(await readFile(notes, 'utf8')).toBe('first\n')
    expect(await write('null')).toBe('saved')
    expect(await readFile(notes, 'utf8')).toBe('written')
  })
})

test('a file deleted on disk keeps its tab, marked, until saving creates it again', async () => {
  await withProject({ 'notes.txt': 'kept text\n' }, async (page, app) => {
    const notes = join(app, 'notes.txt')
    await openFile(page, 'app', 'notes.txt')
    await expect(lines(page)).toContainText('kept text')
    await rm(notes)
    await expect(tab(page, 'notes.txt, deleted on disk')).toBeVisible()
    await expect(lines(page)).toContainText('kept text')
    await saveScreenshot(page, 'editor-deleted-on-disk')
    await lines(page).click()
    await page.keyboard.press('ControlOrMeta+S')
    await expect(tab(page, 'notes.txt')).toBeVisible()
    expect(await readFile(notes, 'utf8')).toBe('kept text\n')
  })
})

test('a large file opens read-only from its start and a binary one is not shown', async () => {
  const line = 'x'.repeat(99) + '\n'
  const large = line.repeat(60_000) // About 6 MB.
  const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x03])
  await withProject({ 'big.log': large, 'image.png': binary }, async (page, app) => {
    await openFile(page, 'app', 'big.log')
    await expect(page.getByRole('status').filter({ hasText: 'big.log' })).toHaveText(
      'big.log is 5.7 MB: only its first 4.0 MB are shown, read-only.'
    )
    await expect(lines(page)).toContainText('xxxx')
    await lines(page).click()
    await page.keyboard.type('typed')
    await expect(lines(page)).not.toContainText('typed')
    await expect(tab(page, 'big.log')).toBeVisible()
    // Main sends no more than the limit.
    const sent = await page.evaluate<number>(
      `window.desktop.readTextFile(${JSON.stringify(join(app, 'big.log'))}).then((file) => file.text.length)`
    )
    expect(sent).toBeLessThanOrEqual(4 * 1024 * 1024)
    expect(sent).toBeGreaterThan(4 * 1024 * 1024 - line.length)

    await openFile(page, 'app', 'image.png')
    await expect(page.getByText('image.png is a binary file (8 bytes), not shown.')).toBeVisible()
    await expect(editor(page)).toBeHidden()
  })
})

test('Markdown tabs preview the rendered text, without running or loading anything from it', async () => {
  const markdown = [
    '# Title here',
    '',
    'Some `inline code` and a [web link](https://example.com/docs).',
    '',
    '```ts',
    'const answer = 42',
    '```',
    '',
    '<script>window.ranFromMarkdown = true</script>',
    '<img src="https://example.com/raw.png" onerror="window.ranFromMarkdown = true">',
    '',
    '![remote picture](https://example.com/picture.png)',
    ''
  ].join('\n')
  await withProject({ 'README.md': markdown }, async (page) => {
    const remote: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('example.com')) remote.push(request.url())
    })
    await openFile(page, 'app', 'README.md')
    await expect(lines(page)).toContainText('# Title here')
    await page.getByRole('button', { name: 'Preview' }).click()
    const preview = page.getByLabel('Markdown preview')
    await expect(preview.getByRole('heading', { name: 'Title here', level: 1 })).toBeVisible()
    await expect(preview.locator('code', { hasText: 'inline code' })).toBeVisible()
    await expect(preview.locator('pre')).toContainText('const answer = 42')
    await expect(preview.getByRole('link', { name: 'web link' })).toHaveAttribute(
      'href',
      'https://example.com/docs'
    )
    await expect(preview).toContainText('[remote picture]')
    await expect(preview.locator('img, script, iframe')).toHaveCount(0)
    expect(await page.evaluate<unknown>('window.ranFromMarkdown')).toBeUndefined()
    expect(remote).toEqual([])
    await saveScreenshot(page, 'editor-markdown-preview')

    // Back to the source; edits there show in the preview. (Saved, so quitting doesn't ask.)
    await page.getByRole('button', { name: 'Preview' }).click()
    await expect(preview).toBeHidden()
    await typeAtEnd(page, '\n## Added later')
    await page.keyboard.press('ControlOrMeta+S')
    await expect(tab(page, 'README.md')).toBeVisible()
    await page.getByRole('button', { name: 'Preview' }).click()
    await expect(preview.getByRole('heading', { name: 'Added later', level: 2 })).toBeVisible()
  })
})

test('links in a Markdown preview open headings and files in the app', async () => {
  const filler = Array.from({ length: 80 }, (_, index) => `Paragraph ${index}.`).join('\n\n')
  const readme = [
    '# Project',
    '',
    '[Usage below](#usage-notes), [the guide](docs/guide.md#install-it), [the code](/src/main.ts),',
    'and [a file URL](file:///etc/passwd).',
    '',
    filler,
    '',
    '## Usage notes',
    '',
    'Run it.'
  ].join('\n')
  const guide = ['# Guide', '', filler, '', '## Install it', '', 'With pnpm.'].join('\n')
  await withProject(
    { 'README.md': readme, 'docs/guide.md': guide, 'src/main.ts': 'export const main = 1\n' },
    async (page) => {
      await openFile(page, 'app', 'README.md')
      await page.getByRole('button', { name: 'Preview' }).click()
      const preview = page.getByLabel('Markdown preview')
      const usage = preview.getByRole('heading', { name: 'Usage notes' })
      await expect(usage).not.toBeInViewport()
      await preview.getByRole('link', { name: 'Usage below' }).click()
      await expect(usage).toBeInViewport()

      // A link to another scheme leads nowhere.
      await preview.getByRole('link', { name: 'a file URL' }).click()
      await expect(tabs(page)).toHaveCount(1)

      // Another Markdown file opens in its preview, at the linked heading.
      await preview.getByRole('link', { name: 'the guide' }).click()
      await expect(tab(page, 'guide.md')).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('button', { name: 'Preview' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await expect(preview.getByRole('heading', { name: 'Install it' })).toBeInViewport()

      // Any other file opens in the editor; a slash starts at the workspace folder.
      await tab(page, 'README.md').click()
      await preview.getByRole('link', { name: 'the code' }).click()
      await expect(tab(page, 'main.ts')).toHaveAttribute('aria-selected', 'true')
      await expect(lines(page)).toContainText('export const main = 1')
    }
  )
})
