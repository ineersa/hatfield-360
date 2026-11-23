import { expect, test, type Page } from '@playwright/test'
import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
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

/** A page script closing the open tab as soon as the editor draws a line; `stopClosing()` ends it. */
const CLOSE_ON_FIRST_LINE = `{
  const observer = new MutationObserver(() => {
    if (document.querySelector('.monaco-editor .view-line')) {
      document.querySelector('[aria-label="Close data.json"]')?.click()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })
  window.stopClosing = () => observer.disconnect()
}`

/** Waits for the server's first error in the open file and expects its message, shown by F8. */
async function expectError(page: Page, message: RegExp): Promise<void> {
  // A server publishes a file's errors once it has loaded the project, cold start included.
  await expect(editor(page).locator('.squiggly-error').first()).toBeVisible({ timeout: 15_000 })
  await editor(page).locator('.view-line').first().click()
  await page.keyboard.press('F8')
  const problem = page.locator('.marker-widget')
  await expect(problem).toContainText(message)
  await page.keyboard.press('Escape')
  await expect(problem).toBeHidden()
}

/** Puts the cursor inside the first `symbol` of the open file, whose text is `text`, with Go to Line. */
async function cursorOn(page: Page, text: string, symbol: string): Promise<void> {
  const at = text.indexOf(symbol)
  if (at < 0) throw new Error(`${symbol} isn't in the file`)
  const before = text.slice(0, at)
  const line = before.split('\n').length
  const column = at - before.lastIndexOf('\n') + 1
  await editor(page).locator('.view-line').first().click()
  await page.keyboard.press('Control+g')
  const goTo = page.locator('.quick-input-widget')
  await expect(goTo).toBeVisible()
  await page.keyboard.type(`${line}:${column}`)
  await page.keyboard.press('Enter')
  await expect(goTo).toBeHidden()
}

/**
 * F12 on `symbol` in the `from` tab, whose text is `text`, opens `target`, which shows `declares`
 * and is read-only. The caller has seen the server's errors for `from`, so its project is loaded.
 */
async function jumpToReadOnly(
  page: Page,
  [from, text]: [string, string],
  symbol: string,
  target: string,
  declares: RegExp
): Promise<void> {
  await tab(page, from).click()
  await cursorOn(page, text, symbol)
  await page.keyboard.press('F12')
  await expect(tab(page, target)).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => editorText(page)).toMatch(declares)
  // Read-only: typing says why and leaves the file unedited.
  await page.keyboard.type('x')
  await expect(page.locator('.monaco-editor-overlaymessage')).toContainText('read-only')
  await expect(tab(page, target)).not.toContainText('●')
  await page.keyboard.press('Escape')
}

test('TypeScript, Python and PHP files get errors from their language servers', async () => {
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
        await expect(editor(page).locator('.squiggly-error')).toHaveCount(0, { timeout: 15_000 })
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
        ).toBeVisible({ timeout: 15_000 })
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

test('a file closed while its server starts leaves none running, and one reopened at once gets a working server, in a linked folder', async () => {
  const [dir, cleanDir] = await makeTempDir('language-server-lifecycle')
  const checkout = join(await realpath(dir), 'checkout')
  await mkdir(checkout)
  await writeFile(join(checkout, 'package.json'), '{ "name": "project" }\n')
  await writeFile(join(checkout, 'data.json'), '{\n  "name": "x",\n}\n')
  // The workspace folder is a link to the project: its server runs in the real folder.
  const project = join(await realpath(dir), 'project')
  await symlink(checkout, project)
  const [userData, cleanUserData] = await seedWorkspace([{ path: project, kind: 'folder' }])
  try {
    await withApp(
      async (app, page) => {
        const appPid = app.process().pid
        if (appPid === undefined) throw new Error('The app has no process id')
        await showView(page, 'Files')
        await item(page, 'project').click()
        const close = page.getByRole('button', { name: 'Close data.json' })
        // The page closes the tab the moment its text shows, while main still starts the server.
        await page.evaluate(CLOSE_ON_FIRST_LINE)
        for (let round = 0; round < 6; round += 1) {
          await item(page, 'data.json').dblclick()
          await expect(close).toBeHidden()
        }
        await page.evaluate('window.stopClosing()')
        await expect.poll(() => serverPids(appPid, VSCODE_SERVERS)).toEqual([])

        const status = page.getByRole('status').filter({ hasText: 'JSON language server' })
        await item(page, 'data.json').dblclick()
        await expect(status).toHaveText('JSON language server ready', { timeout: 15_000 })
        // Reopened while its server shuts down: it gets a new one, which answers.
        await close.click()
        await item(page, 'data.json').dblclick()
        await expectError(page, /Trailing comma/)
        await expect(status).toHaveText('JSON language server ready')
        await expect.poll(() => serverPids(appPid, VSCODE_SERVERS)).toHaveLength(1)
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanDir()
  }
})

test('a crashed language server restarts, and the new one answers for the open file', async () => {
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
        await expectError(page, /Type 'number' is not assignable to type 'string'/)
        const appPid = app.process().pid
        if (appPid === undefined) throw new Error('The app has no process id')
        const [server] = await serverPids(appPid, TYPESCRIPT_SERVER)
        if (server === undefined) throw new Error('No TypeScript server runs')
        process.kill(server, 'SIGKILL')
        // Started again for the open file: one server, not the killed one.
        await expect
          .poll(
            async () =>
              (await serverPids(appPid, TYPESCRIPT_SERVER)).filter((pid) => pid !== server),
            {
              timeout: 15_000
            }
          )
          .toHaveLength(1)
        const status = page.getByRole('status').filter({ hasText: 'TypeScript language server' })
        await expect(status).toHaveText('TypeScript language server ready', { timeout: 15_000 })
        // Only the new server can report an error typed after the crash.
        await typeAtEnd(page, "export const count: number = 'many'")
        await page.keyboard.press('ControlOrMeta+s')
        await expect(tab(page, 'main.ts')).not.toContainText('●')
        await expect(editor(page).locator('.squiggly-error')).toHaveCount(2, { timeout: 15_000 })
      },
      { userDataDir: userData }
    )
  } finally {
    await cleanUserData()
    await cleanDir()
  }
})

test('Go to Definition, hover and references work across files, into dependencies read-only', async () => {
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
    "import { count } from './count'\nimport { dep } from 'dep'\nimport { origin } from './point'\nexport const label = `${dep}${count}${origin}`\nexport const wrong: string = 1\n"
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
        await expectError(page, /Type 'number' is not assignable to type 'string'/)
        const word = (text: string) =>
          editor(page)
            .locator('.view-line span span', { hasText: new RegExp(`^${text}$`) })
            .last()
        const useOfCount = word('count')
        await useOfCount.hover({ force: true })
        await expect(page.getByRole('tooltip', { name: /const count: number/ })).toBeVisible()
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
        // A tab opened on it while the list shows it; once both are gone, its next read is fresh.
        await openFile(page, 'double.ts')
        await expect.poll(() => editorText(page)).toContain('twice = count * 2')
        await page.getByRole('button', { name: 'Close double.ts' }).click()
        await tab(page, 'count.ts').click()
        await page.keyboard.press('Escape')
        await expect(references).toBeHidden()
        await writeFile(
          join(project, 'double.ts'),
          "import { count } from './count'\nexport const twice = count * 3\n"
        )
        await page.keyboard.press('Shift+F12')
        await references.getByText('double.ts', { exact: true }).click()
        await expect(references).toContainText('twice = count * 3')
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

/**
 * Runs `body` in the app with `files` (paths under a temp folder) written and its `project` folder
 * in the workspace, opened in the Files view.
 */
async function withProjectFiles(
  prefix: string,
  files: Record<string, string>,
  body: (page: Page) => Promise<void>,
  env: (dir: string) => Record<string, string> = () => ({})
): Promise<void> {
  const [made, cleanDir] = await makeTempDir(prefix)
  const dir = await realpath(made)
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true })
    await writeFile(join(dir, path), text)
  }
  const [userData, cleanUserData] = await seedWorkspace([
    { path: join(dir, 'project'), kind: 'folder' }
  ])
  try {
    await withApp(
      async (_app, page) => {
        await showView(page, 'Files')
        await body(page)
      },
      { userDataDir: userData, env: env(dir) }
    )
  } finally {
    await cleanUserData()
    await cleanDir()
  }
}

test("Go to Definition opens TypeScript's standard library read-only, served by its server", async () => {
  const list = "export const key: PropertyKey = 'a'\nexport const wrong: string = 1\n"
  await withProjectFiles(
    'library-typescript',
    {
      'project/tsconfig.json': '{ "compilerOptions": { "strict": true } }\n',
      'project/list.ts': list
    },
    async (page) => {
      await openFile(page, 'project', 'list.ts')
      await expectError(page, /Type 'number' is not assignable to type 'string'/)
      await jumpToReadOnly(
        page,
        ['list.ts', list],
        'PropertyKey',
        'lib.es5.d.ts',
        /type PropertyKey = /
      )
      // The library file has the server too: its hover answers there, on the declaration F12 found.
      await page.keyboard.press('ControlOrMeta+k')
      await page.keyboard.press('ControlOrMeta+i')
      await expect(page.getByRole('tooltip', { name: /type PropertyKey = / })).toBeVisible()
    }
  )
})

test("Go to Definition opens Python's typeshed and the interpreter's own modules read-only", async () => {
  const main = 'from acme_tools import acme_size\n\nsize = len("abc")\nwrong: int = "many"\n'
  await withProjectFiles(
    'library-python',
    {
      'project/pyproject.toml': '[project]\nname = "tool"\n',
      'project/main.py': main,
      // A module the interpreter finds outside the project, as one installed system-wide would be.
      'python-lib/acme_tools.py': 'def acme_size(text: str) -> int:\n    return len(text)\n'
    },
    async (page) => {
      await openFile(page, 'project', 'main.py')
      await expectError(page, /is not assignable to declared type "int"/)
      await jumpToReadOnly(page, ['main.py', main], 'len', 'builtins.pyi', /def len\(/)
      await jumpToReadOnly(page, ['main.py', main], 'acme_size', 'acme_tools.py', /def acme_size\(/)
    },
    (dir) => ({ PYTHONPATH: join(dir, 'python-lib') })
  )
})

test("Go to Definition opens PHP's stubs and Composer's vendor folder read-only", async () => {
  const index = "<?php\n\n$size = strlen('abc');\n$name = acme_name();\nmissing_function();\n"
  await withProjectFiles(
    'library-php',
    {
      'project/composer.json': '{}\n',
      'project/index.php': index,
      // A Composer dependency is in the project, but read-only all the same.
      'project/vendor/acme/names.php':
        "<?php\n\nfunction acme_name(): string\n{\n    return 'acme';\n}\n"
    },
    async (page) => {
      await openFile(page, 'project', 'index.php')
      await expectError(page, /Undefined function 'missing_function'/)
      await jumpToReadOnly(page, ['index.php', index], 'strlen', 'Core.php', /function strlen\(/)
      await jumpToReadOnly(
        page,
        ['index.php', index],
        'acme_name',
        'names.php',
        /function acme_name\(/
      )
    }
  )
})

test('Go files get errors from gopls, and Go to Definition opens the standard library read-only', async () => {
  const gopls = await promisify(execFile)('gopls', ['version']).then(
    () => true,
    () => false
  )
  test.skip(!gopls, 'gopls is not installed')
  const [dir, cleanDir] = await makeTempDir('language-server-go')
  const project = join(await realpath(dir), 'project')
  await mkdir(project)
  await writeFile(join(project, 'go.mod'), 'module example.com/project\n\ngo 1.22\n')
  const main =
    'package main\n\nimport "strings"\n\nvar loud = strings.ToUpper("a")\n\nvar count int = "many"\n\nfunc main() {}\n'
  await writeFile(join(project, 'main.go'), main)
  const [userData, cleanUserData] = await seedWorkspace([{ path: project, kind: 'folder' }])
  try {
    await withApp(
      async (_app, page) => {
        await showView(page, 'Files')
        await openFile(page, 'project', 'main.go')
        await expectError(page, /cannot use "many"/)
        await jumpToReadOnly(page, ['main.go', main], 'ToUpper', 'strings.go', /func ToUpper\(/)
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
