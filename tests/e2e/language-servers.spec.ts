import { expect, test, type Page } from '@playwright/test'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { editor, editorText, item, openFile, showView, tab, typeAtEnd } from './editor-page'
import { makeTempDir, withApp } from './launch-app'
import { seedWorkspace } from './workspace-seed'

/** The TypeScript, Python and PHP servers' command lines. */
const LANGUAGE_SERVERS = /tsc --lsp|langserver\.index\.js|intelephense\.js/
const TYPESCRIPT_SERVER = /tsc --lsp/
/** VS Code's JSON, CSS and HTML servers' command lines. */
const VSCODE_SERVERS = /(json|css|html)ServerMain\.js/

/** The app's child processes whose command line matches `match`. */
async function serverPids(appPid: number, match: RegExp): Promise<number[]> {
  const { stdout } = await promisify(execFile)('ps', ['-A', '-o', 'pid=,ppid=,args='])
  return stdout
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((row) => row !== null && Number(row[2]) === appPid && match.test(row[3] ?? ''))
    .map((row) => Number(row?.[1]))
}

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
      async (app, page) => {
        await showView(page, 'Files')
        await openFile(page, 'project', 'web', 'label.ts')
        await expectError(page, /Type 'number' is not assignable to type 'string'/)
        // An agent fixes the other file on disk: the server hears of it and the error goes.
        await writeFile(join(project, 'web', 'count.ts'), "export const count: string = '1'\n")
        await expect(editor(page).locator('.squiggly-error')).toHaveCount(0, { timeout: 20_000 })
        await openFile(page, 'tool', 'main.py')
        await expectError(page, /is not assignable to declared type "int"/)
        await openFile(page, 'site', 'index.php')
        await expectError(page, /Undefined function 'missing_function'/)
        const appPid = app.process().pid
        if (appPid === undefined) throw new Error('The app has no process id')
        expect(await serverPids(appPid, LANGUAGE_SERVERS)).toHaveLength(3)
        // A server stops once none of its files is open, leaving no process behind.
        for (const name of ['label.ts', 'main.py', 'index.php']) {
          await page.getByRole('button', { name: `Close ${name}` }).click()
        }
        await expect.poll(() => serverPids(appPid, LANGUAGE_SERVERS)).toEqual([])
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanDir()
  }
})

test("JSON, CSS and HTML files get VS Code's servers, which stop when their folder leaves the workspace", async () => {
  test.setTimeout(90_000)
  const [dir, cleanDir] = await makeTempDir('language-servers-vscode')
  const project = join(await realpath(dir), 'project')
  await mkdir(project)
  await writeFile(join(project, 'package.json'), '{ "name": "project" }\n')
  await writeFile(join(project, 'data.json'), '{\n  "name": "x",\n}\n')
  await writeFile(join(project, 'style.css'), 'a {\n  color: red;\n')
  await writeFile(join(project, 'page.html'), '<p>hello</p>\n')
  const [userData, cleanUserData] = await seedWorkspace([{ path: project, kind: 'folder' }])
  try {
    await withApp(
      async (app, page) => {
        await showView(page, 'Files')
        await openFile(page, 'project', 'data.json')
        await expectError(page, /Trailing comma/)
        await openFile(page, 'project', 'style.css')
        await expectError(page, /\} expected/)
        await openFile(page, 'project', 'page.html')
        await expect.poll(() => editorText(page)).toContain('<p>hello</p>')
        // Tag names come from the HTML server: the page doesn't mention this one.
        await typeAtEnd(page, '<butto')
        await page.keyboard.press('Control+Space')
        await expect(
          page.locator('.suggest-widget').getByRole('option', { name: /^button/ })
        ).toBeVisible({ timeout: 30_000 })
        await page.keyboard.press('Escape')
        const appPid = app.process().pid
        if (appPid === undefined) throw new Error('The app has no process id')
        expect(await serverPids(appPid, VSCODE_SERVERS)).toHaveLength(3)
        await page.keyboard.press('ControlOrMeta+z')
        await expect(tab(page, 'page.html')).not.toContainText('●')
        await item(page, 'project').click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Remove from Workspace' }).click()
        await expect.poll(() => serverPids(appPid, VSCODE_SERVERS)).toEqual([])
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanDir()
  }
})

test('a crashed language server restarts, and one that keeps crashing is reported once with its log', async () => {
  test.setTimeout(90_000)
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
        const status = page.getByRole('status').filter({ hasText: 'TypeScript language server' })
        await expect(status).toHaveText('TypeScript language server ready', { timeout: 30_000 })
        const appPid = app.process().pid
        if (appPid === undefined) throw new Error('The app has no process id')
        const running = async (): Promise<number> => {
          const [server] = await serverPids(appPid, TYPESCRIPT_SERVER)
          return server ?? 0
        }
        let killed = 0
        for (let crash = 1; crash <= 4; crash += 1) {
          await expect.poll(running, { timeout: 30_000 }).not.toBe(0)
          const server = await running()
          expect(server).not.toBe(killed)
          process.kill(server, 'SIGKILL')
          killed = server
          if (crash < 4) {
            // Started again for the open file, which gets its errors back.
            await expect(status).toHaveText('TypeScript language server ready', { timeout: 30_000 })
            await expect(editor(page).locator('.squiggly-error').first()).toBeVisible({
              timeout: 30_000
            })
          }
        }
        const stopped = page.getByRole('button', {
          name: 'TypeScript language server stopped: show log'
        })
        await expect(stopped).toBeVisible()
        await expect(
          page
            .getByRole('navigation', { name: 'Tool windows' })
            .getByRole('button', { name: 'Notifications (1)' })
        ).toBeVisible()
        await stopped.click()
        const panel = page.getByRole('complementary', { name: 'Notifications panel' })
        await expect(panel).toContainText('The TypeScript language server keeps stopping')
        await expect(panel).toContainText('was killed (SIGKILL)')
        await expect.poll(() => serverPids(appPid, TYPESCRIPT_SERVER)).toEqual([])
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
    "import { count } from './count'\nimport { dep } from 'dep'\nimport { origin } from './point'\nexport const label = `${dep}${count}${origin}`\n"
  )
  await writeFile(
    join(project, 'point.ts'),
    'export interface Point {\n  x: number\n}\nexport const origin: Point = { x: 0 }\n'
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
        // Go to Type Definition lands on the interface, not on the constant.
        await word('origin').click({ button: 'right' })
        // The editor's menu takes the item it has focused, not a click straight after it opens.
        await page.getByRole('menuitem', { name: 'Go to Type Definition' }).hover()
        await page.keyboard.press('Enter')
        await expect(tab(page, 'point.ts')).toHaveAttribute('aria-selected', 'true')
        await expect(editor(page).locator('.active-line-number')).toHaveText('1')

        await tab(page, 'label.ts').click()
        await word('dep').click({ modifiers: ['ControlOrMeta'] })
        await expect(tab(page, 'index.d.ts')).toHaveAttribute('aria-selected', 'true')
        await expect.poll(() => editorText(page)).toContain('export declare const dep: string')
        await page.keyboard.type('x')
        await expect.poll(() => editorText(page)).toContain('export declare const dep: string')
        await expect(page.locator('.monaco-editor-overlaymessage')).toContainText('read-only')

        await tab(page, 'label.ts').click()
        await typeAtEnd(page, 'export const fixed = count.toFi')
        const suggestions = page.locator('.suggest-widget')
        await expect(suggestions.getByRole('option', { name: /toFixed/ })).toBeVisible()
        // The server's documentation for the selected completion, in the details beside the list.
        await page.keyboard.press('Control+Space')
        await expect(page.locator('.suggest-details')).toContainText('fixed-point notation')
        await page.keyboard.press('Enter')
        await expect.poll(() => editorText(page)).toContain('count.toFixed')
        await page.keyboard.press('ControlOrMeta+s')
        await expect(tab(page, 'label.ts')).not.toContainText('●')
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanDir()
  }
})

test('a language server that is not installed is named once, and its files still open highlighted', async () => {
  const [dir, cleanDir] = await makeTempDir('language-server-missing')
  const project = join(await realpath(dir), 'project')
  await mkdir(project)
  await writeFile(join(project, 'go.mod'), 'module example.com/project\n')
  await writeFile(join(project, 'main.go'), 'package main\n\nfunc main() {}\n')
  await writeFile(join(project, 'other.go'), 'package main\n\nfunc other() {}\n')
  const [userData, cleanUserData] = await seedWorkspace([{ path: project, kind: 'folder' }])
  const [emptyPath, cleanPath] = await makeTempDir('empty-path')
  try {
    await withApp(
      async (_app, page) => {
        await showView(page, 'Files')
        await openFile(page, 'project', 'main.go')
        const bell = page.getByRole('navigation', { name: 'Tool windows' })
        await expect(bell.getByRole('button', { name: 'Notifications (1)' })).toBeVisible()
        await openFile(page, 'project', 'other.go')
        await expect.poll(() => editorText(page)).toContain('func other() {}')
        // Highlighted by its grammar: the keyword has its own token.
        await expect(
          editor(page).locator('.view-line span span', { hasText: /^func$/ })
        ).toBeVisible()
        await bell.getByRole('button', { name: 'Notifications (1)' }).click()
        const panel = page.getByRole('complementary', { name: 'Notifications panel' })
        await expect(panel).toContainText('No Go language server')
        await expect(panel).toContainText(
          "gopls isn't installed. Install it with `go install golang.org/x/tools/gopls@latest`."
        )
      },
      // gopls is looked up on PATH; this one has nothing in it.
      { userDataDir: userData, env: { PATH: emptyPath } }
    )
  } finally {
    await cleanUserData()
    await cleanDir()
    await cleanPath()
  }
})
