import { expect, test, type Page } from '@playwright/test'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { editor, editorText, openFile, showView, tab } from './editor-page'
import { makeTempDir, withApp } from './launch-app'
import { seedWorkspace } from './workspace-seed'

/** Hovers the editor's first error squiggle and expects the server's message in the hover. */
async function expectError(page: Page, message: RegExp): Promise<void> {
  const squiggle = editor(page).locator('.squiggly-error').first()
  // Servers index the project first; a cold start can take a while on a slow machine.
  await expect(squiggle).toBeVisible({ timeout: 30_000 })
  // The squiggle is drawn under the text layer; the mouse goes to where it is.
  await squiggle.hover({ force: true })
  await expect(page.locator('.monaco-hover').filter({ hasText: message })).toBeVisible()
  await page.keyboard.press('Escape')
}

test('TypeScript, Python and PHP files get errors from their language servers', async () => {
  test.setTimeout(120_000)
  const [dir, cleanDir] = await makeTempDir('language-servers')
  const project = join(await realpath(dir), 'project')
  await mkdir(join(project, 'web'), { recursive: true })
  await mkdir(join(project, 'tool'))
  await mkdir(join(project, 'site'))
  await writeFile(
    join(project, 'web', 'tsconfig.json'),
    '{ "compilerOptions": { "strict": true } }\n'
  )
  await writeFile(join(project, 'web', 'count.ts'), 'export const count: number = 1\n')
  // The error needs the other file: only a server that sees the project finds it.
  await writeFile(
    join(project, 'web', 'label.ts'),
    "import { count } from './count'\nexport const label: string = count\n"
  )
  await writeFile(join(project, 'tool', 'pyproject.toml'), '[project]\nname = "tool"\n')
  await writeFile(join(project, 'tool', 'main.py'), 'total: int = "many"\n')
  await writeFile(join(project, 'site', 'composer.json'), '{}\n')
  await writeFile(join(project, 'site', 'index.php'), '<?php\n\nmissing_function();\n')
  const [userData, cleanUserData] = await seedWorkspace([{ path: project, kind: 'folder' }])
  try {
    await withApp(
      async (_app, page) => {
        await showView(page, 'Files')
        await openFile(page, 'project', 'web', 'label.ts')
        await expectError(page, /Type 'number' is not assignable to type 'string'/)
        await openFile(page, 'tool', 'main.py')
        await expectError(page, /is not assignable to declared type "int"/)
        await openFile(page, 'site', 'index.php')
        await expectError(page, /Undefined function 'missing_function'/)
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanDir()
  }
})

/** The app's language server processes whose command line includes `match`. */
async function serverPids(appPid: number, match: string): Promise<number[]> {
  const { stdout } = await promisify(execFile)('ps', ['-A', '-o', 'pid=,ppid=,args='])
  return stdout
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((row) => row !== null && Number(row[2]) === appPid && (row[3] ?? '').includes(match))
    .map((row) => Number(row?.[1]))
}

test('a language server that dies is reported in the notifications with its reason', async () => {
  const [dir, cleanDir] = await makeTempDir('language-server-crash')
  const project = join(await realpath(dir), 'project')
  await mkdir(project)
  await writeFile(join(project, 'tsconfig.json'), '{ "compilerOptions": { "strict": true } }\n')
  await writeFile(join(project, 'main.ts'), 'export const label: string = 1\n')
  const [userData, cleanUserData] = await seedWorkspace([{ path: project, kind: 'folder' }])
  try {
    await withApp(
      async (app, page) => {
        await showView(page, 'Files')
        await openFile(page, 'project', 'main.ts')
        await expect(editor(page).locator('.squiggly-error').first()).toBeVisible({
          timeout: 30_000
        })
        const appPid = app.process().pid
        if (appPid === undefined) throw new Error('The app has no process id')
        const [server] = await serverPids(appPid, '--lsp')
        if (server === undefined) throw new Error('The TypeScript server is not running')
        process.kill(server, 'SIGKILL')
        const bell = page
          .getByRole('navigation', { name: 'Tool windows' })
          .getByRole('button', { name: 'Notifications (1)' })
        await bell.click()
        const panel = page.getByRole('complementary', { name: 'Notifications panel' })
        await expect(panel).toContainText('The typescript language server stopped')
        await expect(panel).toContainText('was killed (SIGKILL)')
        await expect.poll(() => serverPids(appPid, '--lsp')).toEqual([])
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanDir()
  }
})

test('Go to Definition, hover and references work across files, into dependencies read-only', async () => {
  test.setTimeout(90_000)
  const [dir, cleanDir] = await makeTempDir('language-server-navigation')
  const project = join(await realpath(dir), 'project')
  const dependency = join(project, 'node_modules', 'dep')
  await mkdir(dependency, { recursive: true })
  await writeFile(join(project, 'tsconfig.json'), '{ "compilerOptions": { "strict": true } }\n')
  // The declaration sits below the first screen, so the jump has to scroll to it.
  await writeFile(
    join(project, 'count.ts'),
    `${'// filler\n'.repeat(80)}export const count: number = 1\n`
  )
  await writeFile(
    join(project, 'label.ts'),
    "import { count } from './count'\nimport { dep } from 'dep'\nexport const label = `${dep}${count}`\n"
  )
  // Never opened in a tab: the reference list reads it from disk.
  await writeFile(
    join(project, 'double.ts'),
    "import { count } from './count'\nexport const twice = count * 2\n"
  )
  await writeFile(join(dependency, 'package.json'), '{ "name": "dep", "types": "index.d.ts" }\n')
  await writeFile(join(dependency, 'index.d.ts'), 'export declare const dep: string\n')
  const [userData, cleanUserData] = await seedWorkspace([{ path: project, kind: 'folder' }])
  try {
    await withApp(
      async (_app, page) => {
        await showView(page, 'Files')
        await openFile(page, 'project', 'label.ts')
        const word = (text: string) =>
          editor(page)
            .locator('.view-line span span', { hasText: new RegExp(`^${text}$`) })
            .last()
        const useOfCount = word('count')
        await expect(useOfCount).toBeVisible()
        // Hover info comes from the server once it has the project loaded.
        await expect(async () => {
          await useOfCount.hover({ force: true })
          await expect(page.getByRole('tooltip', { name: /const count: number/ })).toBeVisible({
            timeout: 2_000
          })
        }).toPass({ timeout: 30_000 })
        await page.keyboard.press('Escape')

        await useOfCount.click()
        await page.keyboard.press('F12')
        await expect(tab(page, 'count.ts')).toHaveAttribute('aria-selected', 'true')
        // The cursor is on the declaration, scrolled into view.
        await expect(editor(page).locator('.active-line-number')).toHaveText('81')
        await page.keyboard.press('Shift+F12')
        const references = page.locator('.reference-zone-widget')
        // Its lines come from the file on disk, which no tab has open.
        await references.getByText('double.ts', { exact: true }).click()
        await expect(references).toContainText('twice = count * 2')
        await page.keyboard.press('Escape')

        await tab(page, 'label.ts').click()
        await word('dep').click({ modifiers: ['ControlOrMeta'] })
        await expect(tab(page, 'index.d.ts')).toHaveAttribute('aria-selected', 'true')
        await expect.poll(() => editorText(page)).toContain('export declare const dep: string')
        await page.keyboard.type('x')
        await expect.poll(() => editorText(page)).toContain('export declare const dep: string')
        await expect(page.locator('.monaco-editor-overlaymessage')).toContainText('read-only')
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanDir()
  }
})
