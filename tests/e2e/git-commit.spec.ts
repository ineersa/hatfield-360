import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tab as editorTab } from './editor-page'
import { git, makeRepo } from './git-repository'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'
import { CLIPBOARD_TAG, keepUserClipboard } from './user-clipboard'

/** git's own output, for checking what the app committed. */
const gitOutput = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/**
 * The repository `app` with a.txt, b.txt and c.txt committed and pushed to a bare `remote.git`,
 * a workspace holding it, and a git config of its own for the commits the app makes.
 */
async function commitFixture(): Promise<{
  repo: string
  remote: string
  userData: string
  env: Record<string, string>
  cleanup: () => Promise<void>
}> {
  const { projects, repo, cleanup } = await makeRepo()
  const remote = join(projects, 'remote.git')
  git(projects, 'init', '-q', '--bare', '-b', 'main', remote)
  for (const name of ['a.txt', 'b.txt', 'c.txt']) await writeFile(join(repo, name), `${name} one\n`)
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'Add files')
  git(repo, 'remote', 'add', 'origin', remote)
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  // The app keeps agent logs and state in the project's .hatfield folder; they are not the test's changes.
  await mkdir(join(repo, '.git', 'info'), { recursive: true })
  await writeFile(join(repo, '.git', 'info', 'exclude'), '.hatfield/\n')
  const userData = join(projects, 'user-data')
  await mkdir(join(userData, 'workspaces'), { recursive: true })
  await writeFile(
    join(userData, 'workspaces', 'default.hatfield-workspace'),
    JSON.stringify({ version: 1, folders: [{ path: repo, kind: 'project' }] })
  )
  // The DOM renderer, so terminal text can be read.
  await writeFile(join(userData, 'settings.json'), '{ "terminal.gpuAcceleration": false }')
  // Main passes its environment to git and hooks: commits stay off the user's config and keys.
  const gitConfig = join(projects, 'gitconfig')
  await writeFile(
    gitConfig,
    '[user]\n\tname = Tester\n\temail = tester@example.com\n[commit]\n\tgpgsign = false\n'
  )
  return {
    repo,
    remote,
    userData,
    env: { GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' },
    cleanup
  }
}

const changes = (page: Page) => page.getByRole('tree', { name: 'Changes' })
const row = (page: Page, name: string) => changes(page).getByRole('treeitem', { name, exact: true })
const include = (page: Page, path: string) =>
  changes(page).getByRole('checkbox', { name: `Include ${path}`, exact: true })
const message = (page: Page) => page.getByRole('textbox', { name: 'Commit message' })
const commitButton = (page: Page) => page.getByRole('button', { name: 'Commit', exact: true })
const showGit = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Views' })
    .getByRole('button', { name: 'Git', exact: true })
    .click()

test('the Commit panel lists changes, commits checked files, amends, and commits and pushes', async () => {
  const fixture = await commitFixture()
  const { repo, remote } = fixture
  await writeFile(join(repo, 'a.txt'), 'a.txt two\n')
  await rm(join(repo, 'b.txt'))
  await writeFile(join(repo, 'new.txt'), 'new\n')
  try {
    await withApp(
      async (_app, page) => {
        await showGit(page)
        // Each file with its status, which is spelled out as well as coloured; the group names its branch.
        await expect(changes(page).getByRole('treeitem', { name: 'app' })).toContainText('main')
        await expect(row(page, 'a.txt')).toHaveAccessibleDescription('modified')
        await expect(row(page, 'b.txt')).toHaveAccessibleDescription('deleted')
        await expect(row(page, 'new.txt')).toHaveAccessibleDescription('untracked')
        await expect(row(page, 'a.txt')).toContainText('M')
        await expect(row(page, 'new.txt')).toContainText('U')
        // Nothing starts checked, and nothing can be committed until something is.
        await expect(include(page, 'a.txt')).not.toBeChecked()
        await message(page).fill('Change a and add new')
        await expect(commitButton(page)).toHaveAttribute('aria-disabled', 'true')

        await include(page, 'a.txt').click()
        // Space checks the focused row; the group's checkbox shows a part checked.
        await row(page, 'new.txt').click()
        await page.keyboard.press('Space')
        await expect(include(page, 'new.txt')).toBeChecked()
        await expect(include(page, 'b.txt')).not.toBeChecked()
        await saveScreenshot(page, 'git-changes')
        await commitButton(page).click()

        await expect(row(page, 'a.txt')).toHaveCount(0)
        await expect(row(page, 'new.txt')).toHaveCount(0)
        await expect(row(page, 'b.txt')).toBeVisible()
        await expect(message(page)).toHaveValue('')
        expect(gitOutput(repo, 'log', '-1', '--format=%s')).toBe('Change a and add new')
        expect(gitOutput(repo, 'show', '--name-status', '--format=', 'HEAD')).toBe(
          'M\ta.txt\nA\tnew.txt'
        )
        // One commit not yet pushed.
        await expect(
          changes(page).getByRole('treeitem', { name: 'app' })
        ).toHaveAccessibleDescription('branch main, 1 to push')

        // Amend fills in the last message; with nothing checked only the message changes.
        await page.getByRole('checkbox', { name: 'Amend' }).check()
        await expect(message(page)).toHaveValue('Change a and add new')
        await message(page).fill('Change a, add new')
        await commitButton(page).click()
        await expect(message(page)).toHaveValue('')
        await expect(page.getByRole('checkbox', { name: 'Amend' })).not.toBeChecked()
        expect(gitOutput(repo, 'log', '--format=%s')).toBe('Change a, add new\nAdd files\nfirst')

        await include(page, 'b.txt').click()
        await message(page).fill('Remove b')
        await page.getByRole('button', { name: 'Commit and Push' }).click()
        // Nothing is left to push only once the push is done: status read earlier still counts the commits.
        await expect(
          changes(page).getByRole('treeitem', { name: 'app' })
        ).toHaveAccessibleDescription('branch main')
        await expect(changes(page).getByText('No changes')).toBeVisible()
        expect(gitOutput(remote, 'log', '--format=%s', 'main')).toBe(
          'Remove b\nChange a, add new\nAdd files\nfirst'
        )
      },
      { userDataDir: fixture.userData, env: fixture.env }
    )
  } finally {
    await fixture.cleanup()
  }
})

test("a failing pre-commit hook's output is shown and nothing is committed", async () => {
  const fixture = await commitFixture()
  const { repo } = fixture
  await writeFile(join(repo, 'a.txt'), 'a.txt two\n')
  await writeFile(join(repo, 'new.txt'), 'new\n')
  await mkdir(join(repo, '.git', 'hooks'), { recursive: true })
  const hook = join(repo, '.git', 'hooks', 'pre-commit')
  await writeFile(
    hook,
    '#!/bin/sh\necho "lint: a.txt:1 no trailing newline"\necho "1 problem" >&2\nexit 1\n'
  )
  await chmod(hook, 0o755)
  try {
    await withApp(
      async (_app, page) => {
        await showGit(page)
        await changes(page).getByRole('checkbox', { name: 'Include all changes in app' }).click()
        await message(page).fill('Should not land')
        await message(page).press('ControlOrMeta+Enter')

        const failure = page.getByRole('alert').filter({ hasText: 'Commit failed in app' })
        await expect(failure.getByLabel('Git output')).toHaveText(
          'lint: a.txt:1 no trailing newline\n1 problem'
        )
        await saveScreenshot(page, 'git-hook-failure')
        expect(gitOutput(repo, 'log', '--format=%s')).toBe('Add files\nfirst')
        // The new file is not left staged, and both stay listed and checked for another try.
        expect(gitOutput(repo, 'status', '--porcelain')).toBe('M a.txt\n?? new.txt')
        await expect(include(page, 'new.txt')).toBeChecked()
        await expect(message(page)).toHaveValue('Should not land')

        await failure.getByRole('button', { name: 'Dismiss' }).click()
        await expect(failure).toHaveCount(0)
      },
      { userDataDir: fixture.userData, env: fixture.env }
    )
  } finally {
    await fixture.cleanup()
  }
})

test('rollback restores tracked files and deletes untracked ones once confirmed', async () => {
  const fixture = await commitFixture()
  const { repo } = fixture
  await writeFile(join(repo, 'a.txt'), 'a.txt two\n')
  await writeFile(join(repo, 'new.txt'), 'new\n')
  try {
    await withApp(
      async (_app, page) => {
        await showGit(page)
        const rollback = page.getByRole('button', { name: 'Rollback' })
        await expect(rollback).toBeDisabled()
        await include(page, 'a.txt').click()
        await include(page, 'new.txt').click()
        await rollback.click()

        const dialog = page.getByRole('alertdialog', { name: 'Roll back 2 files?' })
        await expect(
          dialog.getByRole('list', { name: 'Files to roll back' }).getByRole('listitem')
        ).toHaveText(['Ma.txtmodified', 'Unew.txtuntracked'])
        await saveScreenshot(page, 'git-rollback-dialog')
        // Cancel leaves everything as it was.
        await dialog.getByRole('button', { name: 'Cancel' }).click()
        expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('a.txt two\n')

        await rollback.click()
        await page.getByRole('button', { name: 'Roll Back' }).click()
        await expect(changes(page).getByText('No changes')).toBeVisible()
        expect(await readFile(join(repo, 'a.txt'), 'utf8')).toBe('a.txt one\n')
        expect(existsSync(join(repo, 'new.txt'))).toBe(false)
      },
      { userDataDir: fixture.userData, env: fixture.env }
    )
  } finally {
    await fixture.cleanup()
  }
})

test(
  'Review without hunk installed shows how to install hunk and the review skill',
  { tag: CLIPBOARD_TAG },
  async () => {
    const fixture = await commitFixture()
    const [home, cleanHome] = await makeTempDir('home')
    try {
      await withApp(
        async (app, page) => {
          const restoreClipboard = await keepUserClipboard(app)
          try {
            await showGit(page)
            const main = page.getByRole('main', { name: 'Git' })
            await expect(
              main.getByRole('heading', { name: 'Review changes with hunk' })
            ).toBeVisible()

            await page.getByRole('button', { name: 'Review app' }).click()
            await expect(main.getByRole('alert')).toContainText("hunk isn't installed")
            await expect(main.getByRole('button', { name: 'Copy brew install hunk' })).toBeVisible()
            await expect(
              main.getByRole('button', {
                name: 'Copy npx skills add modem-dev/hunk -g --skill hunk-review'
              })
            ).toBeVisible()
            await saveScreenshot(page, 'git-hunk-missing')

            await main.getByRole('button', { name: 'Copy brew install hunk' }).click()
            await expect(main.getByText('Copied', { exact: true })).toBeAttached()
            expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
              'brew install hunk'
            )

            await main.getByRole('alert').getByRole('button', { name: 'Dismiss' }).click()
            await expect(
              main.getByRole('heading', { name: 'Review changes with hunk' })
            ).toBeVisible()
          } finally {
            await restoreClipboard()
          }
        },
        {
          userDataDir: fixture.userData,
          // The lookup runs `command -v hunk` in the user's interactive shell: give it nothing to find.
          env: { ...fixture.env, PATH: '/usr/bin:/bin', HOME: home, SHELL: '/bin/bash' }
        }
      )
    } finally {
      await cleanHome()
      await fixture.cleanup()
    }
  }
)

test('Review, Log and file diffs run hunk in tabs in the Git view, which close when hunk ends', async () => {
  const fixture = await commitFixture()
  const { repo } = fixture
  await writeFile(join(repo, 'c.txt'), 'c.txt two\n')
  const [bin, cleanBin] = await makeTempDir('bin')
  const [home, cleanHome] = await makeTempDir('home')
  // Says how it was started, then ends once a line is typed, as hunk does on q.
  await writeFile(join(bin, 'hunk'), '#!/bin/sh\necho "fake hunk $* in $PWD"\nread reply\n')
  await chmod(join(bin, 'hunk'), 0o755)
  try {
    await withApp(
      async (_app, page) => {
        await showGit(page)
        await page.getByRole('button', { name: 'Review app' }).click()
        const review = page.getByRole('tabpanel', { name: 'Review · app' })
        await expect(review.locator('.xterm-rows')).toContainText(
          `fake hunk diff --watch in ${repo}`
        )
        await expect(page.getByRole('main', { name: 'Git' }).getByRole('tab')).toHaveText([
          'Review · app'
        ])

        await page.getByRole('button', { name: 'Log app' }).click()
        const log = page.getByRole('tabpanel', { name: 'Log · app' })
        await expect(log.locator('.xterm-rows')).toContainText(`fake hunk log in ${repo}`)
        // Review again goes back to its tab instead of starting another hunk.
        await page.getByRole('button', { name: 'Review app' }).click()
        await expect(page.getByRole('tab', { name: 'Review · app' })).toHaveAttribute(
          'aria-selected',
          'true'
        )
        await expect(page.getByRole('main', { name: 'Git' }).getByRole('tab')).toHaveCount(2)
        await saveScreenshot(page, 'git-hunk-tabs')

        // hunk keeps running in a hidden tab while another view is shown.
        await page
          .getByRole('navigation', { name: 'Views' })
          .getByRole('button', { name: 'Files', exact: true })
          .click()
        await showGit(page)
        await expect(review).toBeVisible()

        await page.getByRole('button', { name: 'Close Log · app' }).click()
        await review.locator('.xterm-screen').click()
        await page.keyboard.press('Enter')
        await expect(page.getByRole('main', { name: 'Git' }).getByRole('tab')).toHaveCount(0)
        await expect(page.getByRole('heading', { name: 'Review changes with hunk' })).toBeVisible()

        // A double click shows the file's own changes since HEAD, its name taken literally.
        await row(page, 'c.txt').dblclick()
        const diff = page.getByRole('tabpanel', { name: 'c.txt · app' })
        await expect(diff.locator('.xterm-rows')).toContainText(
          `fake hunk diff --watch HEAD -- :(literal)c.txt in ${repo}`
        )
        await saveScreenshot(page, 'git-hunk-file-diff')
        // The diff's bar opens the file in the editor, in the Files view.
        await diff
          .getByRole('toolbar', { name: 'Diff' })
          .getByRole('button', { name: 'Open in Editor' })
          .click()
        await expect(page.getByRole('main', { name: 'Files' })).toBeVisible()
        await expect(editorTab(page, 'c.txt')).toHaveAttribute('aria-selected', 'true')
        // So does the row's menu.
        await showGit(page)
        await row(page, 'c.txt').click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Open in Editor' }).click()
        await expect(page.getByRole('main', { name: 'Files' })).toBeVisible()
      },
      {
        userDataDir: fixture.userData,
        env: { ...fixture.env, PATH: `${bin}:/usr/bin:/bin`, HOME: home, SHELL: '/bin/bash' }
      }
    )
  } finally {
    await cleanHome()
    await cleanBin()
    await fixture.cleanup()
  }
})
