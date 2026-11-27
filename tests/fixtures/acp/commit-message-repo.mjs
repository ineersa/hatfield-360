// The repository the commit-message cassette was recorded in, made the same way by the recorder
// and by tests/e2e/git-commit-message.spec.ts, so the app sends the agent the same prompt.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** The user's rules in Settings: they make the agent read a diff, so the replay covers file_diff. */
export const COMMIT_MESSAGE_INSTRUCTIONS =
  'Always read the diff of src/greeting.js with the file_diff tool before writing. Start the subject with "greeting: ".'

/** The file checked for the commit. */
export const COMMIT_MESSAGE_PATH = 'src/greeting.js'

const git = (cwd, ...args) =>
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      ...args
    ],
    { cwd, stdio: 'ignore' }
  )

/** Commits the copied cassette project on `main`, then changes the greeting's wording in the worktree. */
export function makeCommitMessageRepo(repo) {
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'Add the greeting script')
  // The app keeps its own state in .hatfield/; it isn't a change to describe.
  mkdirSync(join(repo, '.git', 'info'), { recursive: true })
  writeFileSync(join(repo, '.git', 'info', 'exclude'), '.hatfield/\n')
  writeFileSync(
    join(repo, 'src', 'greeting.js'),
    '/** The greeting shown to a visitor. */\nexport function greeting(name) {\n  return `Welcome back, ${name}!`\n}\n'
  )
}
