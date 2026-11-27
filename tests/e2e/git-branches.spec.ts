import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { changes, commitFixture, git, gitOutput, row, showGit } from './git-repository'
import { saveScreenshot, withApp } from './launch-app'

const popup = (page: Page) => page.getByRole('dialog', { name: 'Branches of app' })
const options = (page: Page) =>
  popup(page).getByRole('listbox', { name: 'Branches' }).getByRole('option')
const option = (page: Page, name: string) => options(page).filter({ hasText: name })
const search = (page: Page) => popup(page).getByRole('combobox', { name: 'Search branches' })
const openBranches = (page: Page) =>
  changes(page).getByRole('button', { name: 'Branches of app' }).click()
/** The Switch dialog asking to confirm a switch to `name`. */
const confirmSwitch = (page: Page, name: string) =>
  page.getByRole('alertdialog', { name: `Switch to ${name}?` })
const current = (repo: string): string => gitOutput(repo, 'branch', '--show-current')
const branches = (repo: string): string[] =>
  gitOutput(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n')
/** The project's row in the Agents view's workspace list, which names its branch. */
const workspaceRow = (page: Page) =>
  page.getByRole('list', { name: 'Workspace folders' }).locator(':scope > li[aria-label]')

test('the branch popup lists, filters and switches branches, and creates and deletes them', async () => {
  const fixture = await commitFixture()
  const { repo } = fixture
  git(repo, 'branch', 'feature')
  git(repo, 'branch', 'merged-work')
  git(repo, 'switch', '-q', '-c', 'wip')
  await writeFile(join(repo, 'wip.txt'), 'wip\n')
  git(repo, 'add', 'wip.txt')
  git(repo, 'commit', '-q', '-m', 'Work in progress')
  git(repo, 'switch', '-q', 'main')
  // A branch only the remote has.
  git(repo, 'push', '-q', 'origin', 'main:shared')
  try {
    await withApp(
      async (_app, page) => {
        await showGit(page)
        const app = row(page, 'app')
        await expect(app).toHaveAccessibleDescription('branch main')

        await openBranches(page)
        await expect(options(page)).toHaveText([
          'New Branch…',
          'main',
          'feature',
          'merged-work',
          'wip',
          'origin/main',
          'origin/shared'
        ])
        await expect(option(page, 'main').first()).toHaveAccessibleName('main, current')
        await saveScreenshot(page, 'git-branches')
        await search(page).fill('feat')
        await expect(options(page)).toHaveText(['feature'])
        // Nothing switches until the dialog saying what will happen is confirmed.
        await page.keyboard.press('Enter')
        await expect(popup(page)).toHaveCount(0)
        const toFeature = confirmSwitch(page, 'feature')
        await expect(toFeature).toContainText('Checks out feature in app, leaving main.')
        await expect(toFeature).toContainText('There are no local changes.')
        await toFeature.getByRole('button', { name: 'Cancel' }).click()
        expect(current(repo)).toBe('main')
        await openBranches(page)
        await search(page).fill('feat')
        await page.keyboard.press('Enter')
        await expect(toFeature.getByRole('button', { name: 'Switch' })).toBeFocused()
        await page.keyboard.press('Enter')
        await expect(toFeature).toHaveCount(0)
        await expect(app).toHaveAccessibleDescription('branch feature')
        expect(current(repo)).toBe('feature')

        // A remote branch becomes a local branch tracking it.
        await openBranches(page)
        await option(page, 'origin/shared').click()
        const toShared = confirmSwitch(page, 'origin/shared')
        await expect(toShared).toContainText(
          'Creates the local branch shared at origin/shared, tracking it, and checks it out in app, leaving feature.'
        )
        await saveScreenshot(page, 'git-branch-switch')
        await toShared.getByRole('button', { name: 'Switch' }).click()
        await expect(app).toHaveAccessibleDescription('branch shared')
        expect(gitOutput(repo, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/shared')

        // New Branch… starts at the current branch and switches to the new one.
        await openBranches(page)
        await option(page, 'New Branch…').click()
        const dialog = page.getByRole('alertdialog', { name: 'New Branch' })
        await expect(dialog).toContainText(
          'Creates the branch in app at the current branch, shared, then checks it out'
        )
        await dialog.getByRole('checkbox', { name: 'Switch to it' }).uncheck()
        await expect(dialog).toContainText('shared stays checked out.')
        await dialog.getByRole('checkbox', { name: 'Switch to it' }).check()
        await dialog.getByRole('textbox', { name: 'Branch name' }).fill('main')
        await dialog.getByRole('button', { name: 'Create' }).click()
        await expect(dialog.getByRole('alert')).toHaveText('A branch named main already exists.')
        await dialog.getByRole('textbox', { name: 'Branch name' }).fill('topic/new')
        await dialog.getByRole('button', { name: 'Create' }).click()
        await expect(dialog).toHaveCount(0)
        await expect(app).toHaveAccessibleDescription('branch topic/new')
        expect(current(repo)).toBe('topic/new')

        // Right Arrow lists a branch's other actions; a merged branch is deleted once confirmed.
        await openBranches(page)
        await search(page).fill('merged')
        await page.keyboard.press('ArrowRight')
        const actions = popup(page).getByRole('listbox', { name: 'Actions for merged-work' })
        await expect(actions.getByRole('option')).toHaveText([
          'Switch to merged-work…',
          'New Branch from merged-work…',
          'Delete merged-work…'
        ])
        await actions.getByRole('option', { name: 'Delete merged-work…' }).click()
        const confirm = page.getByRole('alertdialog', { name: 'Delete branch merged-work?' })
        await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
        await expect(confirm).toHaveCount(0)
        expect(branches(repo)).not.toContain('merged-work')

        // An unmerged branch names the commit it would lose and needs Force Delete.
        await openBranches(page)
        await search(page).fill('wip')
        await page.keyboard.press('ArrowRight')
        await page.keyboard.press('End')
        await page.keyboard.press('Enter')
        await page
          .getByRole('alertdialog', { name: 'Delete branch wip?' })
          .getByRole('button', { name: 'Delete', exact: true })
          .click()
        const refused = page.getByRole('alertdialog', { name: 'wip is not fully merged' })
        await expect(
          refused.getByRole('list', { name: 'Commits that would be lost' })
        ).toContainText('Work in progress')
        expect(branches(repo)).toContain('wip')
        await saveScreenshot(page, 'git-branch-unmerged')
        await refused.getByRole('button', { name: 'Force Delete' }).click()
        await expect(refused).toHaveCount(0)
        expect(branches(repo)).not.toContain('wip')

        // The workspace list follows the switches.
        await page
          .getByRole('navigation', { name: 'Views' })
          .getByRole('button', { name: 'Agents', exact: true })
          .click()
        await expect(workspaceRow(page)).toHaveText(['apptopic/new'])
      },
      { userDataDir: fixture.userData, env: fixture.env }
    )
  } finally {
    await fixture.cleanup()
  }
})

test("a switch git refuses shows git's output and changes nothing; the repository menu opens the branches", async () => {
  const fixture = await commitFixture()
  const { repo } = fixture
  git(repo, 'switch', '-q', '-c', 'other')
  await writeFile(join(repo, 'a.txt'), 'other\n')
  git(repo, 'commit', '-q', '-am', 'Change a on other')
  // origin/other's name is taken by a local branch that doesn't track it.
  git(repo, 'push', '-q', 'origin', 'other')
  git(repo, 'switch', '-q', 'main')
  await writeFile(join(repo, 'a.txt'), 'mine\n')
  git(repo, 'switch', '-q', '--detach')
  try {
    await withApp(
      async (_app, page) => {
        await showGit(page)
        const app = row(page, 'app')
        await expect(app).toHaveAccessibleDescription(/^branch detached/)
        await app.click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Branches…' }).click()
        await expect(popup(page)).toContainText('HEAD is detached at')
        await search(page).fill('other')
        await page.keyboard.press('Enter')
        const toOther = confirmSwitch(page, 'other')
        await expect(toOther).toContainText(/leaving the detached HEAD at \w+\./)
        // The dialog says git will refuse before the switch is tried.
        await expect(toOther).toContainText(
          'Git will refuse the switch: this file has local changes and differs on other.'
        )
        await expect(toOther.getByRole('list', { name: 'Files git would refuse over' })).toHaveText(
          'a.txt'
        )
        await toOther.getByRole('button', { name: 'Switch' }).click()
        await expect(
          page.getByRole('alert').filter({ hasText: 'Switch to other failed in app' })
        ).toContainText('a.txt')
        expect(gitOutput(repo, 'branch', '--show-current')).toBe('')
        await expect(app).toHaveAccessibleDescription(/^branch detached/)

        // A remote branch whose name is taken says why it can't be checked out, offering a new branch.
        await openBranches(page)
        await search(page).fill('origin/other')
        await page.keyboard.press('Enter')
        await expect(popup(page)).toContainText(
          "The local branch other doesn't track origin/other, so origin/other can't be checked out as other"
        )
        await expect(
          popup(page).getByRole('listbox', { name: 'Actions for origin/other' }).getByRole('option')
        ).toHaveText(['New Branch from origin/other…'])
        await page.keyboard.press('Escape')
        await expect(popup(page)).toHaveCount(0)

        // From a detached HEAD a branch can be switched to.
        await openBranches(page)
        await search(page).fill('main')
        await page.keyboard.press('Enter')
        await confirmSwitch(page, 'main').getByRole('button', { name: 'Switch' }).click()
        await expect(app).toHaveAccessibleDescription(/^branch main/)
        expect(current(repo)).toBe('main')
      },
      { userDataDir: fixture.userData, env: fixture.env }
    )
  } finally {
    await fixture.cleanup()
  }
})
