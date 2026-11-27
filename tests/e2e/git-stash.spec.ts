import { expect, test, type Page } from '@playwright/test'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { changes, commitFixture, git, gitOutput, row, showGit } from './git-repository'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'

const include = (page: Page, path: string) =>
  changes(page).getByRole('checkbox', { name: `Include ${path}`, exact: true })
const selectToAdd = (page: Page, path: string) =>
  changes(page).getByRole('checkbox', { name: `Select ${path} to add`, exact: true })
const stashButton = (page: Page) => page.getByRole('button', { name: 'Stash Changes', exact: true })
const dialog = (page: Page) => page.getByRole('alertdialog')
const stashes = (page: Page) => dialog(page).getByRole('radio')

async function repositoryMenu(page: Page, action: string): Promise<void> {
  await row(page, 'app').click({ button: 'right' })
  await page.getByRole('menuitem', { name: action }).click()
}

/** Stashes the checked files from the panel's header with `message`. */
async function stash(page: Page, message: string): Promise<void> {
  await stashButton(page).click()
  await dialog(page).getByRole('textbox', { name: 'Stash message' }).fill(message)
  await dialog(page).getByRole('button', { name: 'Stash', exact: true }).click()
  await expect(dialog(page)).toHaveCount(0)
}

test('Stash Changes puts only the chosen files aside, and Unstash Changes pops, applies and drops them', async () => {
  const fixture = await commitFixture()
  const { repo } = fixture
  for (const name of ['a.txt', 'b.txt', 'c.txt']) await writeFile(join(repo, name), `${name} two\n`)
  await writeFile(join(repo, 'new.txt'), 'new\n')
  await writeFile(join(repo, 'loose.txt'), 'stays on disk\n')
  try {
    await withApp(
      async (_app, page) => {
        await showGit(page)
        // Nothing chosen: nothing to stash, and both ways in say so.
        await expect(stashButton(page)).toHaveAttribute('aria-disabled', 'true')
        await row(page, 'app').click({ button: 'right' })
        await expect(page.getByRole('menuitem', { name: /^Stash Changes…/ })).toHaveAttribute(
          'aria-disabled',
          'true'
        )
        await expect(page.getByRole('menuitem', { name: /^Stash Changes…/ })).toContainText(
          'Check the files to stash'
        )
        await page.keyboard.press('Escape')

        await include(page, 'a.txt').click()
        await include(page, 'b.txt').click()
        await page.getByRole('button', { name: 'Expand All' }).click()
        await selectToAdd(page, 'new.txt').click()
        await stashButton(page).click()
        await expect(dialog(page).getByRole('list', { name: 'Files to stash' })).toHaveText(
          /a\.txt.*b\.txt.*new\.txt/
        )
        await dialog(page).getByRole('textbox', { name: 'Stash message' }).fill('half done')
        await saveScreenshot(page, 'git-stash-dialog')
        await dialog(page).getByRole('button', { name: 'Stash', exact: true }).click()

        // The chosen files leave the changes; c.txt and the unchosen new file stay.
        await expect(row(page, 'a.txt')).toHaveCount(0)
        await expect(row(page, 'b.txt')).toHaveCount(0)
        await expect(row(page, 'c.txt')).toBeVisible()
        expect(existsSync(join(repo, 'new.txt'))).toBe(false)
        expect(await readFile(join(repo, 'loose.txt'), 'utf8')).toBe('stays on disk\n')
        expect(gitOutput(repo, 'stash', 'list', '--format=%gs')).toBe('On main: half done')

        // Unstash lists it with its branch and age; Pop brings the files back and removes it.
        await repositoryMenu(page, 'Unstash Changes…')
        await expect(dialog(page)).toContainText('Unstash Changes · app')
        await expect(stashes(page)).toHaveCount(1)
        await expect(stashes(page).first()).toBeChecked()
        await expect(dialog(page).getByRole('radiogroup')).toContainText('half done')
        await expect(dialog(page).getByRole('radiogroup')).toContainText(
          /main · (\d+[mhd] ago|yesterday)/
        )
        await saveScreenshot(page, 'git-unstash-dialog')
        await dialog(page).getByRole('button', { name: 'Pop', exact: true }).click()
        await expect(row(page, 'a.txt')).toBeVisible()
        await expect(row(page, 'b.txt')).toBeVisible()
        expect(await readFile(join(repo, 'new.txt'), 'utf8')).toBe('new\n')
        expect(gitOutput(repo, 'stash', 'list')).toBe('')

        // Apply brings it back and keeps it.
        await include(page, 'a.txt').click()
        await stash(page, 'only a')
        await expect(row(page, 'a.txt')).toHaveCount(0)
        await repositoryMenu(page, 'Unstash Changes…')
        await dialog(page).getByRole('button', { name: 'Apply', exact: true }).click()
        await expect(row(page, 'a.txt')).toBeVisible()
        expect(gitOutput(repo, 'stash', 'list', '--format=%gs')).toBe('On main: only a')

        // Drop asks first, then the list shows what is left.
        await repositoryMenu(page, 'Unstash Changes…')
        await dialog(page).getByRole('button', { name: 'Drop…' }).click()
        await expect(dialog(page)).toContainText('Drop “only a”?')
        await dialog(page).getByRole('button', { name: 'Drop', exact: true }).click()
        await expect(dialog(page)).toContainText('app has no stashes.')
        expect(gitOutput(repo, 'stash', 'list')).toBe('')
        await dialog(page).getByRole('button', { name: 'Close' }).click()
        await expect(page.getByRole('alert')).toHaveCount(0)
      },
      { userDataDir: fixture.userData, env: fixture.env }
    )
  } finally {
    await fixture.cleanup()
  }
})

test('a conflicting pop shows git’s output, lists the conflict and keeps the stash', async () => {
  const fixture = await commitFixture()
  const { repo } = fixture
  await writeFile(join(repo, 'a.txt'), 'stashed\n')
  try {
    await withApp(
      async (_app, page) => {
        await showGit(page)
        await include(page, 'a.txt').click()
        await stash(page, 'mine')
        await expect(row(page, 'a.txt')).toHaveCount(0)
        // The same line changes in a commit meanwhile.
        await writeFile(join(repo, 'a.txt'), 'committed\n')
        git(repo, 'commit', '-q', '-am', 'Change a')

        await repositoryMenu(page, 'Unstash Changes…')
        await dialog(page).getByRole('button', { name: 'Pop', exact: true }).click()
        const failure = page.getByRole('alert').filter({ hasText: 'Pop failed in app' })
        await expect(failure).toContainText('CONFLICT')
        await expect(row(page, 'a.txt')).toHaveAccessibleDescription('conflicted')
        expect(gitOutput(repo, 'stash', 'list', '--format=%gs')).toBe('On main: mine')
      },
      { userDataDir: fixture.userData, env: fixture.env }
    )
  } finally {
    await fixture.cleanup()
  }
})

test('View shows the chosen stash in a hunk tab', async () => {
  const fixture = await commitFixture()
  const { repo } = fixture
  const [bin, cleanBin] = await makeTempDir('bin')
  const [home, cleanHome] = await makeTempDir('home')
  await writeFile(join(bin, 'hunk'), '#!/bin/sh\necho "fake hunk $* in $PWD"\nread reply\n')
  await chmod(join(bin, 'hunk'), 0o755)
  await writeFile(join(repo, 'a.txt'), 'older\n')
  try {
    await withApp(
      async (_app, page) => {
        await showGit(page)
        await include(page, 'a.txt').click()
        await stash(page, 'older')
        await writeFile(join(repo, 'b.txt'), 'newer\n')
        await include(page, 'b.txt').click()
        await stash(page, 'newer')

        // The older stash is stash@{1} now: hunk is given that, not the newest.
        await repositoryMenu(page, 'Unstash Changes…')
        await dialog(page).getByText('older', { exact: true }).click()
        await expect(dialog(page).getByRole('radio', { name: /older/ })).toBeChecked()
        await dialog(page).getByRole('button', { name: 'View', exact: true }).click()
        const view = page.getByRole('tabpanel', { name: 'Stash · app · older' })
        await expect(view.locator('.xterm-rows')).toContainText(
          `fake hunk stash show stash@{1} in ${repo}`
        )

        // Popped, the stash can't be shown again: its tab closes.
        await repositoryMenu(page, 'Unstash Changes…')
        await dialog(page).getByText('older', { exact: true }).click()
        await dialog(page).getByRole('button', { name: 'Pop', exact: true }).click()
        await expect(row(page, 'a.txt')).toBeVisible()
        await expect(page.getByRole('tab', { name: /^Stash · app · older/ })).toHaveCount(0)
        await expect(view).toHaveCount(0)
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
