import { expect, test } from '@playwright/test'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { editor, openFile, showView } from './editor-page'
import { makeTempDir, withApp } from './launch-app'
import { seedWorkspace } from './workspace-seed'

// Nothing here waits on a real language server: how fast one answers depends on machine load. A
// fake one that answers at once stands in where a test needs a server running.

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

/**
 * A `gopls` that asks for progress along with its `initialize` answer (as early as LSP allows, and
 * before the client's own handler is in place), and exits as Intelephense does when the answer is an
 * error. Its progress waits for `done.go` to open.
 */
const PROGRESS_SERVER = `
let buffer = Buffer.alloc(0)
const send = (message) => {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message })
  process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n\\r\\n' + body)
}
const progress = (value) => send({ method: '$/progress', params: { token: 'index', value } })
const handle = (message) => {
  if (message.method === 'initialize') {
    send({ id: message.id, result: { capabilities: { textDocumentSync: 1 } } })
    send({ id: 'create', method: 'window/workDoneProgress/create', params: { token: 'index' } })
  }
  else if (message.id === 'create') {
    if (message.error) process.exit(1)
    progress({ kind: 'begin', title: 'Indexing', percentage: 0 })
    progress({ kind: 'report', message: '3/6 files', percentage: 50 })
  } else if (message.method === 'textDocument/didOpen' && message.params.textDocument.uri.endsWith('/done.go')) progress({ kind: 'end' })
  else if (message.method === 'exit') process.exit(0)
  else if (message.id !== undefined && message.method) send({ id: message.id, result: null })
}
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  for (;;) {
    const end = buffer.indexOf('\\r\\n\\r\\n')
    if (end < 0) return
    const length = Number(/Content-Length: (\\d+)/i.exec(buffer.subarray(0, end).toString())[1])
    if (buffer.length < end + 4 + length) return
    handle(JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString()))
    buffer = buffer.subarray(end + 4 + length)
  }
})
`

test('a server that asks for progress as soon as it starts keeps running and shows its progress', async () => {
  const [dir, cleanDir] = await makeTempDir('language-server-progress')
  const project = join(await realpath(dir), 'project')
  await mkdir(project)
  await writeFile(join(project, 'go.mod'), 'module example.com/project\n')
  await writeFile(join(project, 'main.go'), 'package main\n\nfunc main() {}\n')
  await writeFile(join(project, 'done.go'), 'package main\n\nfunc done() {}\n')
  const [userData, cleanUserData] = await seedWorkspace([{ path: project, kind: 'folder' }])
  const [bin, cleanBin] = await makeTempDir('fake-gopls')
  await writeFile(join(bin, 'gopls'), `#!${process.execPath}\n${PROGRESS_SERVER}`, { mode: 0o755 })
  try {
    await withApp(
      async (_app, page) => {
        await showView(page, 'Files')
        await openFile(page, 'project', 'main.go')
        const status = page.getByRole('status').filter({ hasText: 'Go language server' })
        await expect(status).toHaveText('Go language server: Indexing 3/6 files 50%')
        await openFile(page, 'project', 'done.go')
        await expect(status).toHaveText('Go language server ready')
      },
      { userDataDir: userData, env: { PATH: bin } }
    )
  } finally {
    await cleanUserData()
    await cleanDir()
    await cleanBin()
  }
})
