import { expect, test, type Page } from '@playwright/test'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { editor, openFile, showView } from './editor-page'
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
