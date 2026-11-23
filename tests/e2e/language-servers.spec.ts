import { expect, test } from '@playwright/test'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { editor, openFile, showView } from './editor-page'
import { makeTempDir, withApp } from './launch-app'
import { seedWorkspace } from './workspace-seed'

// Nothing here waits on a running language server: how fast one answers depends on machine load.

test("Python's search path can't open the home folder to the page: PYTHONPATH=$HOME reads no key", async () => {
  const [made, cleanDir] = await makeTempDir('library-home')
  const home = join(await realpath(made), 'home')
  const sitePackages = join(home, '.local', 'lib', 'python3.12', 'site-packages')
  await mkdir(join(home, '.ssh'), { recursive: true })
  await mkdir(sitePackages, { recursive: true })
  await writeFile(join(home, '.ssh', 'id_ed25519'), 'secret key\n')
  await writeFile(join(sitePackages, 'acme.py'), 'NAME = "acme"\n')
  try {
    await withApp(
      async (_app, page) => {
        await page.waitForLoadState()
        const read = (path: string) =>
          page.evaluate(
            `window.desktop.readTextFile(${JSON.stringify(path)}).then((file) => file.kind, () => 'refused')`
          )
        expect(await read(join(home, '.ssh', 'id_ed25519'))).toBe('refused')
        // Python's own folders in home stay readable, as Go to Definition needs them.
        expect(await read(join(sitePackages, 'acme.py'))).toBe('text')
      },
      { env: { HOME: home, PYTHONPATH: [home, sitePackages].join(delimiter) } }
    )
  } finally {
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
        await expect(editor(page)).toContainText('func other() {}')
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
