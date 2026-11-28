import { expect, test, type Page } from '@playwright/test'
import { chmod, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { commitFixture, git, row, showGit } from './git-repository'
import { makeTempDir, saveScreenshot, withApp } from './launch-app'

const dialog = (page: Page) => page.getByRole('alertdialog')
const terminalText = (page: Page, tab: string) =>
  page.getByRole('tabpanel', { name: tab }).locator('.xterm-rows')

async function repositoryMenu(page: Page): Promise<void> {
  await row(page, 'app').click({ button: 'right' })
}

/**
 * A PATH holding a fake hunk, which prints how it was run, and git and sh: nothing else, so no
 * `gh` either (on usrmerged systems /bin is /usr/bin, which may have one).
 */
async function fakeHunkPath(): Promise<[string, () => Promise<void>]> {
  const [bin, cleanBin] = await makeTempDir('bin')
  await writeFile(join(bin, 'hunk'), '#!/bin/sh\necho "fake hunk $* in $PWD"\nread reply\n')
  await chmod(join(bin, 'hunk'), 0o755)
  await symlink('/usr/bin/git', join(bin, 'git'))
  await symlink('/bin/sh', join(bin, 'sh'))
  return [bin, cleanBin]
}

test('Review Branch shows the branch’s commits since its base in hunk, against a base that can be changed', async () => {
  const fixture = await commitFixture()
  const { repo } = fixture
  const [bin, cleanBin] = await fakeHunkPath()
  const [home, cleanHome] = await makeTempDir('home')
  git(repo, 'switch', '-q', '-c', 'feature')
  await writeFile(join(repo, 'a.txt'), 'feature\n')
  git(repo, 'commit', '-q', '-am', 'Feature work')
  try {
    await withApp(
      async (_app, page) => {
        await showGit(page)
        await repositoryMenu(page)
        const reviewBranch = page.getByRole('menuitem', { name: /^Review Branch vs/ })
        // A pushed `git init` has no origin/HEAD: the base is origin/main.
        await expect(reviewBranch).toContainText('vs origin/main')
        // origin is a folder, not GitHub: no pull request actions.
        await expect(page.getByRole('menuitem', { name: /Pull Request/ })).toHaveCount(0)
        await saveScreenshot(page, 'git-review-menu')
        await reviewBranch.click()
        await expect(terminalText(page, 'Branch · app · feature vs origin/main')).toContainText(
          `fake hunk diff origin/main...HEAD in ${repo}`
        )

        await repositoryMenu(page)
        await page.getByRole('menuitem', { name: 'Review Branch Against…' }).click()
        await expect(dialog(page)).toContainText('Review feature Against…')
        // The current branch isn't offered; the default base is chosen.
        await expect(dialog(page).getByRole('radio', { name: /^feature/ })).toHaveCount(0)
        await expect(dialog(page).getByRole('radio', { name: /^origin\/main/ })).toBeChecked()
        await dialog(page).getByRole('textbox', { name: 'Filter branches' }).fill('mai')
        await expect(dialog(page).getByRole('radio')).toHaveCount(2)
        await dialog(page).getByText('main', { exact: true }).click()
        await expect(dialog(page).getByRole('radio', { name: /^main/ })).toBeChecked()
        await saveScreenshot(page, 'git-review-base')
        await dialog(page).getByRole('button', { name: 'Review', exact: true }).click()
        await expect(terminalText(page, 'Branch · app · feature vs main')).toContainText(
          `fake hunk diff main...HEAD in ${repo}`
        )
        // The first tab is still there, for its own base.
        await expect(page.getByRole('tab', { name: /feature vs origin\/main/ })).toHaveCount(1)

        // On another branch, Review Branch is that branch's review, not the old tab again.
        git(repo, 'switch', '-q', '-c', 'other', 'main')
        await page.getByRole('button', { name: 'Refresh', exact: true }).click()
        await expect(row(page, 'app')).toContainText('other')
        await repositoryMenu(page)
        await page.getByRole('menuitem', { name: /^Review Branch vs origin\/main/ }).click()
        await expect(terminalText(page, 'Branch · app · other vs origin/main')).toContainText(
          `fake hunk diff origin/main...HEAD in ${repo}`
        )
        await expect(page.getByRole('tab', { name: /feature vs origin\/main/ })).toHaveCount(1)
      },
      {
        userDataDir: fixture.userData,
        env: { ...fixture.env, PATH: bin, HOME: home, SHELL: '/bin/bash' }
      }
    )
  } finally {
    await cleanHome()
    await cleanBin()
    await fixture.cleanup()
  }
})

test('without gh, Review Pull Request… on a GitHub repository says what to install', async () => {
  const fixture = await commitFixture()
  const { repo } = fixture
  const [bin, cleanBin] = await fakeHunkPath()
  const [home, cleanHome] = await makeTempDir('home')
  git(repo, 'remote', 'set-url', 'origin', 'git@github.com:example/app.git')
  try {
    await withApp(
      async (_app, page) => {
        await showGit(page)
        await repositoryMenu(page)
        await page.getByRole('menuitem', { name: 'Review Pull Request…' }).click()
        await expect(dialog(page)).toContainText('Pull Requests · app')
        await expect(dialog(page)).toContainText(
          'Listing pull requests needs the GitHub CLI, gh, on your shell’s PATH.'
        )
        await saveScreenshot(page, 'git-review-no-gh')
        await dialog(page).getByRole('button', { name: 'Close' }).click()
        // Review Branch still works without it.
        await repositoryMenu(page)
        await expect(page.getByRole('menuitem', { name: /^Review Branch vs/ })).toContainText(
          'vs origin/main'
        )
      },
      {
        userDataDir: fixture.userData,
        env: { ...fixture.env, PATH: bin, HOME: home, SHELL: '/bin/bash' }
      }
    )
  } finally {
    await cleanHome()
    await cleanBin()
    await fixture.cleanup()
  }
})
