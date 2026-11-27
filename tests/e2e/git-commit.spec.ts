import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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
    '[user]\n\tname = Tester\n\temail = tester@example.com\n[commit]\n\tgpgsign = false\n[pull]\n\trebase = false\n'
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
const selectToAdd = (page: Page, path: string) =>
  changes(page).getByRole('checkbox', { name: `Select ${path} to add`, exact: true })
const includeAll = (page: Page) =>
  changes(page).getByRole('checkbox', { name: 'Include all changes in app' })
const unversioned = (page: Page) => row(page, 'Unversioned Files')
async function contextMenu(page: Page, name: string, action: string): Promise<void> {
  await row(page, name).click({ button: 'right' })
  await page.getByRole('menuitem', { name: action }).click()
}
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
        await expect(row(page, 'a.txt')).toContainText('M')
        // Untracked files wait, folded, under Unversioned Files.
        await expect(unversioned(page)).toHaveAccessibleDescription('1 file')
        await expect(unversioned(page)).toHaveAttribute('aria-expanded', 'false')
        await expect(row(page, 'new.txt')).toHaveCount(0)
        await unversioned(page).click()
        await expect(row(page, 'new.txt')).toHaveAccessibleDescription('untracked')
        await expect(row(page, 'new.txt')).toContainText('U')
        // Nothing starts checked, and nothing can be committed until something is.
        await expect(include(page, 'a.txt')).not.toBeChecked()
        await message(page).fill('Change a and add new')
        await expect(commitButton(page)).toHaveAttribute('aria-disabled', 'true')

        // An untracked file is checked to be added, never to be committed as it is.
        await expect(include(page, 'new.txt')).toHaveCount(0)
        const addButton = changes(page).getByRole('button', { name: 'Add to VCS in app' })
        await expect(addButton).toHaveAttribute('aria-disabled', 'true')
        await selectToAdd(page, 'new.txt').click()
        await expect(commitButton(page)).toHaveAttribute('aria-disabled', 'true')
        await expect(includeAll(page)).not.toBeChecked()
        await addButton.click()
        await expect(row(page, 'new.txt')).toHaveAccessibleDescription('added')
        await expect(row(page, 'new.txt')).toContainText('A')
        await expect(include(page, 'new.txt')).not.toBeChecked()
        await expect(unversioned(page)).toHaveCount(0)

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

        // A double click opens a changed file in the editor, in the Files view.
        await writeFile(join(repo, 'c.txt'), 'c.txt two\n')
        await page.getByRole('button', { name: 'Refresh' }).click()
        await row(page, 'c.txt').dblclick()
        await expect(page.getByRole('main', { name: 'Files' })).toBeVisible()
        await expect(editorTab(page, 'c.txt')).toHaveAttribute('aria-selected', 'true')
      },
      { userDataDir: fixture.userData, env: fixture.env }
    )
  } finally {
    await fixture.cleanup()
  }
})

test('Cancel stops a commit whose hook is waiting, and nothing is committed', async () => {
  const fixture = await commitFixture()
  const { repo } = fixture
  await writeFile(join(repo, 'a.txt'), 'a.txt two\n')
  const started = join(repo, '..', 'hook-started')
  const blocked = join(repo, '..', 'hook-blocked')
  execFileSync('mkfifo', [started, blocked])
  await mkdir(join(repo, '.git', 'hooks'), { recursive: true })
  const hook = join(repo, '.git', 'hooks', 'pre-commit')
  // The hook prints, says it started, then waits on a pipe nobody ever writes to.
  await writeFile(
    hook,
    `#!/bin/sh\necho "checking a.txt"\necho started > '${started}'\nexec 3<> '${blocked}'\nread line <&3\n`
  )
  await chmod(hook, 0o755)
  try {
    await withApp(
      async (_app, page) => {
        await showGit(page)
        await include(page, 'a.txt').click()
        await message(page).fill('Never lands')
        await commitButton(page).click()
        expect(await readFile(started, 'utf8')).toBe('started\n')
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()

        const cancelled = page.getByRole('alert').filter({ hasText: 'Commit cancelled in app' })
        await expect(cancelled.getByLabel('Git output')).toHaveText('checking a.txt')
        await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
        await saveScreenshot(page, 'git-commit-cancelled')
        expect(gitOutput(repo, 'log', '--format=%s')).toBe('Add files\nfirst')
        expect(gitOutput(repo, 'status', '--porcelain')).toBe('M a.txt')
        await expect(include(page, 'a.txt')).toBeChecked()
        await expect(message(page)).toHaveValue('Never lands')
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
        await includeAll(page).click()
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
        await expect(include(page, 'a.txt')).toBeChecked()
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

test('rollback restores changed files and deletes added ones once confirmed', async () => {
  const fixture = await commitFixture()
  const { repo } = fixture
  await writeFile(join(repo, 'a.txt'), 'a.txt two\n')
  await writeFile(join(repo, 'new.txt'), 'new\n')
  git(repo, 'add', 'new.txt')
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
        ).toHaveText(['Ma.txtmodified', 'Anew.txtadded'])
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

test('Unversioned Files selects untracked files to add, and rows have menus to act on them', async () => {
  const fixture = await commitFixture()
  const { repo } = fixture
  await writeFile(join(repo, 'a.txt'), 'a.txt two\n')
  await writeFile(join(repo, 'b.txt'), 'b.txt two\n')
  await writeFile(join(repo, 'x [1].txt'), 'x\n')
  await writeFile(join(repo, 'y.txt'), 'y\n')
  // The system trash is kept in this folder, never the user's own.
  const [dataHome, cleanDataHome] = await makeTempDir('data-home')
  try {
    await withApp(
      async (_app, page) => {
        await showGit(page)
        await expect(unversioned(page)).toHaveAccessibleDescription('2 files')
        // The node's checkbox selects every untracked file to add, and only those.
        await changes(page)
          .getByRole('checkbox', { name: 'Select all unversioned files in app to add' })
          .click()
        await unversioned(page).click()
        await expect(selectToAdd(page, 'x [1].txt')).toBeChecked()
        await expect(selectToAdd(page, 'y.txt')).toBeChecked()
        await expect(includeAll(page)).not.toBeChecked()
        await selectToAdd(page, 'y.txt').click()
        await expect(
          changes(page).getByRole('checkbox', {
            name: 'Select all unversioned files in app to add'
          })
        ).toBeChecked({ indeterminate: true })
        await saveScreenshot(page, 'git-unversioned')

        // Add to .gitignore ignores exactly that file, and .gitignore becomes a change.
        await contextMenu(page, 'x [1].txt', 'Add to .gitignore')
        await expect(row(page, 'x [1].txt')).toHaveCount(0)
        await expect(row(page, '.gitignore')).toHaveAccessibleDescription('untracked')
        expect(await readFile(join(repo, '.gitignore'), 'utf8')).toBe('/x \\[1].txt\n')

        // Rollback… asks about that file only.
        await include(page, 'b.txt').click()
        await contextMenu(page, 'a.txt', 'Rollback…')
        const dialog = page.getByRole('alertdialog', { name: 'Roll back 1 file?' })
        await expect(
          dialog.getByRole('list', { name: 'Files to roll back' }).getByRole('listitem')
        ).toHaveText(['Ma.txtmodified'])
        await dialog.getByRole('button', { name: 'Cancel' }).click()

        // Commit File… leaves only that file checked and the message box ready.
        await contextMenu(page, 'a.txt', 'Commit File…')
        await expect(include(page, 'a.txt')).toBeChecked()
        await expect(include(page, 'b.txt')).not.toBeChecked()
        await expect(message(page)).toBeFocused()

        // Delete… moves an untracked file to the trash.
        await contextMenu(page, 'y.txt', 'Delete…')
        await page.getByRole('button', { name: 'Move to Trash' }).click()
        await expect(row(page, 'y.txt')).toHaveCount(0)
        expect(await readdir(join(dataHome, 'Trash', 'files'))).toEqual(['y.txt'])

        // Add to VCS lists the last untracked file as added, and Unversioned Files goes.
        await contextMenu(page, '.gitignore', 'Add to VCS')
        await expect(row(page, '.gitignore')).toHaveAccessibleDescription('added')
        await expect(unversioned(page)).toHaveCount(0)

        // The delete key on a tracked file trashes it too, which leaves it deleted.
        await row(page, 'b.txt').click()
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Backspace' : 'Delete')
        await page
          .getByRole('alertdialog', { name: 'Delete file "b.txt"?' })
          .getByRole('button', { name: 'Move to Trash' })
          .click()
        await expect(row(page, 'b.txt')).toHaveAccessibleDescription('deleted')
        expect(existsSync(join(repo, 'b.txt'))).toBe(false)
        expect((await readdir(join(dataHome, 'Trash', 'files'))).toSorted()).toEqual([
          'b.txt',
          'y.txt'
        ])
      },
      { userDataDir: fixture.userData, env: { ...fixture.env, XDG_DATA_HOME: dataHome } }
    )
  } finally {
    await cleanDataHome()
    await fixture.cleanup()
  }
})

test("Fetch from a repository's menu counts what another clone pushed", async () => {
  const fixture = await commitFixture()
  const { remote } = fixture
  const other = join(remote, '..', 'other')
  git(join(remote, '..'), 'clone', '-q', remote, other)
  await writeFile(join(other, 'pushed.txt'), 'pushed\n')
  git(other, 'add', 'pushed.txt')
  git(other, 'commit', '-q', '-m', 'Pushed from another clone')
  git(other, 'push', '-q')
  try {
    await withApp(
      async (_app, page) => {
        await showGit(page)
        const app = changes(page).getByRole('treeitem', { name: 'app' })
        await expect(app).toHaveAccessibleDescription('branch main')
        await app.click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Fetch', exact: true }).click()
        await expect(app).toHaveAccessibleDescription('branch main, 1 to pull')
      },
      { userDataDir: fixture.userData, env: fixture.env }
    )
  } finally {
    await fixture.cleanup()
  }
})

test('Amend works on one repository at a time, a failed push keeps the message for the rest, and Pull skips a repository without an upstream', async () => {
  const fixture = await commitFixture()
  const { repo, remote } = fixture
  const projects = join(repo, '..')
  // lib comes first in the workspace and has no remote, so its push fails before app is committed.
  const lib = join(projects, 'lib')
  git(projects, 'init', '-q', '-b', 'main', lib)
  await writeFile(join(lib, 'l.txt'), 'l one\n')
  git(lib, 'add', '.')
  git(lib, 'commit', '-q', '-m', 'Add lib')
  await writeFile(
    join(fixture.userData, 'workspaces', 'default.hatfield-workspace'),
    JSON.stringify({
      version: 1,
      folders: [
        { path: lib, kind: 'project' },
        { path: repo, kind: 'project' }
      ]
    })
  )
  const other = join(projects, 'other')
  git(projects, 'clone', '-q', remote, other)
  await writeFile(join(other, 'pushed.txt'), 'pushed\n')
  git(other, 'add', 'pushed.txt')
  git(other, 'commit', '-q', '-m', 'Pushed from another clone')
  git(other, 'push', '-q')
  git(repo, 'fetch', '-q')
  await writeFile(join(repo, 'a.txt'), 'a.txt two\n')
  await writeFile(join(lib, 'l.txt'), 'l two\n')
  try {
    await withApp(
      async (_app, page) => {
        await showGit(page)
        const app = changes(page).getByRole('treeitem', { name: 'app' })
        await expect(app).toHaveAccessibleDescription('branch main, 1 to pull')

        // With no row selected, Pull pulls every repository it can and skips lib.
        const pull = page.getByRole('button', { name: 'Pull', exact: true })
        await pull.hover()
        await expect(page.getByRole('tooltip')).toHaveText(
          "Pull app, one after another; lib can't be pulled"
        )
        await pull.click()
        await expect(app).toHaveAccessibleDescription('branch main')
        await expect(page.getByRole('alert')).toHaveCount(0)

        // Amend names the repository whose last commit it replaces, and reads its message.
        await include(page, 'l.txt').click()
        await page.getByRole('checkbox', { name: 'Amend last commit in lib' }).check()
        await expect(message(page)).toHaveValue('Add lib')
        // Files checked in two repositories: Amend can't run.
        await include(page, 'a.txt').click()
        await expect(commitButton(page)).toHaveAttribute('aria-disabled', 'true')
        // Closes the row's tooltip, still open from checking it, so the button's can show.
        await page.keyboard.press('Escape')
        await commitButton(page).hover()
        await expect(
          page.getByRole('tooltip', {
            name: 'Amend works on one repository at a time: check files in only one'
          })
        ).toBeVisible()
        await saveScreenshot(page, 'git-amend-two-repositories')
        // The untouched message follows the target to app; typed words stay where they are.
        await include(page, 'l.txt').click()
        await expect(message(page)).toHaveValue('Pushed from another clone')
        await expect(page.getByRole('checkbox', { name: 'Amend last commit in app' })).toBeChecked()
        await message(page).fill('Change a and l')
        await include(page, 'l.txt').click()
        await include(page, 'a.txt').click()
        await expect(page.getByRole('checkbox', { name: 'Amend last commit in lib' })).toBeChecked()
        await expect(message(page)).toHaveValue('Change a and l')
        await page.getByRole('checkbox', { name: 'Amend last commit in lib' }).uncheck()
        await expect(message(page)).toHaveValue('Change a and l')

        // lib's commit lands but its push fails: app is never committed, and keeps the message.
        await include(page, 'a.txt').click()
        await page.getByRole('button', { name: 'Commit and Push' }).click()
        const failure = page.getByRole('alert').filter({ hasText: 'Push failed in lib' })
        await expect(failure.getByLabel('Git output')).toContainText(
          'No configured push destination'
        )
        await expect(row(page, 'l.txt')).toHaveCount(0)
        await expect(include(page, 'a.txt')).toBeChecked()
        await expect(message(page)).toHaveValue('Change a and l')
        expect(gitOutput(lib, 'log', '--format=%s')).toBe('Change a and l\nAdd lib')
        expect(gitOutput(repo, 'log', '-1', '--format=%s')).toBe('Pushed from another clone')
      },
      { userDataDir: fixture.userData, env: fixture.env }
    )
  } finally {
    await fixture.cleanup()
  }
})

test("a conflicting Pull's merge is shown and concluded from the Commit panel", async () => {
  const fixture = await commitFixture()
  const { repo, remote } = fixture
  const projects = join(repo, '..')
  const other = join(projects, 'other')
  git(projects, 'clone', '-q', remote, other)
  await writeFile(join(other, 'a.txt'), 'theirs\n')
  await writeFile(join(other, 'c.txt'), 'c.txt from the other clone\n')
  git(other, 'commit', '-q', '-am', 'Theirs')
  git(other, 'push', '-q')
  await writeFile(join(repo, 'a.txt'), 'ours\n')
  git(repo, 'commit', '-q', '-am', 'Ours')
  try {
    await withApp(
      async (_app, page) => {
        await showGit(page)
        const app = changes(page).getByRole('treeitem', { name: 'app' })
        await page.getByRole('button', { name: 'Pull', exact: true }).click()
        await expect(
          page.getByRole('alert').filter({ hasText: 'Pull failed in app' }).getByLabel('Git output')
        ).toContainText('CONFLICT (content): Merge conflict in a.txt')
        await expect(app).toHaveAccessibleDescription('branch main, merging, 1 to push, 1 to pull')
        await expect(app).toContainText('Merging')
        await expect(row(page, 'a.txt')).toHaveAccessibleDescription('conflicted')

        await writeFile(join(repo, 'a.txt'), 'ours and theirs\n')
        await include(page, 'a.txt').click()
        await expect(
          page.getByText(
            'Committing concludes the merge in app and includes everything the merge already staged.'
          )
        ).toBeVisible()
        await saveScreenshot(page, 'git-merging')
        await message(page).fill('Merge theirs')
        await commitButton(page).click()

        await expect(app).toHaveAccessibleDescription('branch main, 2 to push')
        await expect(changes(page).getByText('No changes')).toBeVisible()
        expect(gitOutput(repo, 'log', '-1', '--format=%P %s').split(' ')).toHaveLength(4)
        expect(gitOutput(repo, 'show', 'HEAD:c.txt')).toBe('c.txt from the other clone')
      },
      { userDataDir: fixture.userData, env: fixture.env }
    )
  } finally {
    await fixture.cleanup()
  }
})

test('a nested repository is listed as a folder that can be ignored or deleted, never added', async () => {
  const fixture = await commitFixture()
  const { repo } = fixture
  git(repo, 'init', '-q', join(repo, 'vendor', 'lib'))
  await writeFile(join(repo, 'new.txt'), 'new\n')
  try {
    await withApp(
      async (_app, page) => {
        await showGit(page)
        await unversioned(page).click()
        await expect(row(page, 'lib')).toHaveAccessibleDescription('nested repository, in vendor')
        await expect(
          changes(page).getByRole('checkbox', { name: 'vendor/lib is a nested repository' })
        ).toBeDisabled()
        await saveScreenshot(page, 'git-nested-repository')

        await row(page, 'lib').click({ button: 'right' })
        await expect(page.getByRole('menuitem', { name: /^Add to VCS/ })).toHaveAttribute(
          'aria-disabled',
          'true'
        )
        await page.getByRole('menuitem', { name: /^Delete/ }).click()
        await page
          .getByRole('alertdialog', { name: 'Delete folder "lib"?' })
          .getByRole('button', { name: 'Cancel' })
          .click()

        // Add All adds the files and leaves the nested repository alone.
        await contextMenu(page, 'Unversioned Files', 'Add All to VCS')
        await expect(row(page, 'new.txt')).toHaveAccessibleDescription('added')
        await expect(row(page, 'lib')).toHaveAccessibleDescription('nested repository, in vendor')

        await contextMenu(page, 'lib', 'Add to .gitignore')
        await expect(row(page, 'lib')).toHaveCount(0)
        expect(await readFile(join(repo, '.gitignore'), 'utf8')).toBe('/vendor/lib/\n')
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

test('Review and Log run hunk in tabs in the Git view, which close when hunk ends', async () => {
  const fixture = await commitFixture()
  const { repo } = fixture
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
        // Against HEAD, not the index, so staged changes are reviewed too.
        await expect(review.locator('.xterm-rows')).toContainText(
          `fake hunk diff --watch HEAD in ${repo}`
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
