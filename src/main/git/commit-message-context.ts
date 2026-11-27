import { runGitWithOutput } from './git-command'
import { diffBase, lastCommitMessage, repositoryPaths, runOrThrow } from './source-control'

/** Enough of the history to show the repository's style. */
const SUBJECTS = 10
/** Files named in the prompt; the rest are counted. */
const FILES_LISTED = 150
/** A diff the agent asks for is cut here, so one huge file can't slow the answer down. */
const DIFF_LIMIT = 16_000

type ChangeSummary = {
  path: string
  /** Where a renamed file came from; null otherwise. */
  from: string | null
  kind: 'modified' | 'added' | 'deleted' | 'renamed'
  /** Lines added and deleted; null for a binary file. */
  added: number | null
  deleted: number | null
}

/** What the agent is told about a commit about to be made: names and counts, never the diffs. */
export type CommitMessageContext = {
  branch: string | null
  /** The checked files' changes against HEAD (the empty tree before the first commit). */
  files: ChangeSummary[]
  /** With Amend: the commit being replaced, its message and its own changes. */
  amended: { message: string; files: ChangeSummary[] } | null
  /** The newest commits' subjects, newest first. */
  subjects: string[]
}

const KINDS: Record<string, ChangeSummary['kind']> = {
  A: 'added',
  C: 'added',
  D: 'deleted',
  R: 'renamed'
}

/** `git … --name-status -z` and `--numstat -z` output of the same diff, joined per file. */
function summaries(nameStatus: string, numstat: string): ChangeSummary[] {
  const counts = new Map<string, { added: number | null; deleted: number | null }>()
  const stats = numstat.split('\0')
  for (let index = 0; index < stats.length; index++) {
    const [added = '', deleted = '', path = ''] = (stats[index] ?? '').split('\t')
    if (added === '') continue
    // A rename's numstat names no path in its own field: the old and new paths follow it.
    const key = path === '' ? (stats[(index += 2)] ?? '') : path
    counts.set(key, {
      added: added === '-' ? null : Number(added),
      deleted: deleted === '-' ? null : Number(deleted)
    })
  }
  const files: ChangeSummary[] = []
  const fields = nameStatus.split('\0')
  for (let index = 0; index < fields.length; index++) {
    const status = fields[index] ?? ''
    if (status === '') continue
    const letter = status[0] ?? 'M'
    const paired = letter === 'R' || letter === 'C'
    const from = paired ? (fields[++index] ?? '') : null
    const path = fields[++index] ?? ''
    const count = counts.get(path) ?? { added: null, deleted: null }
    files.push({
      path,
      from: letter === 'R' ? from : null,
      kind: KINDS[letter] ?? 'modified',
      ...count
    })
  }
  return files
}

/** The changes a `diff` or `diff-tree` range names, each file once with its line counts. */
async function changesBetween(root: string, range: string[]): Promise<ChangeSummary[]> {
  const [nameStatus, numstat] = await Promise.all([
    runOrThrow(root, [...range, '--name-status', '-z', '-M']),
    runOrThrow(root, [...range, '--numstat', '-z', '-M'])
  ])
  return summaries(nameStatus, numstat)
}

/** HEAD's own changes, against its parent or, for the first commit, nothing. */
const headChanges = (root: string): Promise<ChangeSummary[]> =>
  changesBetween(root, ['diff-tree', '-r', '--root', '--no-commit-id', 'HEAD'])

/** The checked paths' changes against `base`, read from the whole working tree's diff. */
async function checkedChanges(root: string, paths: string[]): Promise<ChangeSummary[]> {
  const wanted = new Set(paths)
  const base = await diffBase(root)
  const all = await changesBetween(root, ['diff', '--no-ext-diff', base])
  return all.filter(
    (file) => wanted.has(file.path) || (file.from !== null && wanted.has(file.from))
  )
}

/** Reads what the commit panel would commit, from a request whose paths main still has to check. */
export async function commitMessageContext(
  root: string,
  request: { paths: unknown; amend: boolean }
): Promise<CommitMessageContext> {
  const paths = repositoryPaths(root, request.paths)
  const [branch, files, subjects, amended] = await Promise.all([
    runGitWithOutput(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { parsed: true }),
    checkedChanges(root, paths),
    runGitWithOutput(root, ['log', `-${SUBJECTS}`, '--no-show-signature', '--format=%s'], {
      parsed: true
    }),
    request.amend
      ? Promise.all([lastCommitMessage(root), headChanges(root)])
      : Promise.resolve(null)
  ])
  return {
    branch: branch.exitCode === 0 ? branch.stdout.trim() : null,
    files,
    amended:
      amended === null || amended[0] === null ? null : { message: amended[0], files: amended[1] },
    subjects: subjects.exitCode === 0 ? subjects.stdout.split('\n').filter(Boolean) : []
  }
}

function describe(file: ChangeSummary): string {
  const name = file.from === null ? file.path : `${file.from} → ${file.path}`
  const counts =
    file.added === null || file.deleted === null ? 'binary' : `+${file.added} -${file.deleted}`
  return `- ${file.kind} ${name} (${counts})`
}

function fileList(files: ChangeSummary[]): string {
  const listed = files.slice(0, FILES_LISTED).map(describe)
  const rest = files.length - listed.length
  return [...listed, ...(rest > 0 ? [`- and ${rest} more files`] : [])].join('\n')
}

/** Kept short and fixed: it replaces Claude Code's own system prompt, so a turn starts fast. */
export const COMMIT_MESSAGE_SYSTEM_PROMPT = [
  'You write git commit messages.',
  'Answer with the commit message only: no preamble, quotes or code fences.',
  'A subject line in the imperative mood, under 72 characters, saying what the change does; then, only when the change needs explaining, a blank line and a short body wrapped at 72 characters saying why.',
  "Follow the user's rules for commit messages when there are any, else the style of the recent subjects.",
  'Say what changed, not which files: a subject like "Update a.txt" or "Modify config" is wrong.',
  "Work from the file names and line counts when they show what changed. When they don't, call the file_diff tool first, for the few files that matter most."
].join('\n')

/** The turn's prompt: names and counts of what will be committed, the style to follow, the user's rules. */
export function commitMessagePrompt(context: CommitMessageContext, instructions: string): string {
  const parts = [
    context.branch === null ? 'HEAD is detached.' : `Branch: ${context.branch}`,
    context.subjects.length > 0
      ? `Recent commit subjects, newest first:\n${context.subjects.map((subject) => `- ${subject}`).join('\n')}`
      : 'The repository has no commits yet.'
  ]
  if (context.amended !== null)
    parts.push(
      `This replaces the last commit (amend). Its message:\n${context.amended.message}\n\nIts changes:\n${fileList(context.amended.files)}`,
      context.files.length > 0
        ? `Changes added to it now:\n${fileList(context.files)}`
        : 'Nothing is added to it: only its message changes.',
      'Write the message for the commit as a whole.'
    )
  else parts.push(`Changes to commit:\n${fileList(context.files)}`)
  const rules = instructions.trim()
  if (rules !== '') parts.push(`The user's rules for commit messages:\n${rules}`)
  return parts.join('\n\n')
}

/** The message in an agent's reply: without fences or quotes around it, trailing space or blank lines. */
export function replyMessage(reply: string): string {
  let text = reply.trim()
  const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(text)
  if (fenced?.[1] !== undefined) text = fenced[1].trim()
  if (/^(["'`]).*\1$/s.test(text)) text = text.slice(1, -1).trim()
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

const literal = (path: string): string => `:(literal)${path}`

/** A change's paths as literal pathspecs: a rename's both. */
const sides = (file: ChangeSummary): string[] =>
  (file.from === null ? [file.path] : [file.from, file.path]).map(literal)

/**
 * One file's diff, for the agent that asked: a file in the context only, against the same base,
 * cut at a size that keeps the turn fast.
 */
export async function contextFileDiff(
  root: string,
  context: CommitMessageContext,
  path: string
): Promise<string> {
  const named = (file: ChangeSummary): boolean => file.path === path || file.from === path
  const checked = context.files.find(named)
  const amended = context.amended?.files.find(named)
  if (checked === undefined && amended === undefined)
    throw new Error(`${path} isn't one of the changes to commit.`)
  const parts: string[] = []
  if (amended !== undefined)
    parts.push(
      await runOrThrow(root, [
        'diff-tree',
        '-p',
        '-r',
        '-M',
        '--root',
        '--no-commit-id',
        '--no-ext-diff',
        '--no-color',
        'HEAD',
        '--',
        ...sides(amended)
      ])
    )
  if (checked !== undefined)
    parts.push(
      await runOrThrow(root, [
        'diff',
        '-M',
        '--no-ext-diff',
        '--no-color',
        await diffBase(root),
        '--',
        ...sides(checked)
      ])
    )
  const diff = parts.join('\n')
  return diff.length > DIFF_LIMIT
    ? `${diff.slice(0, DIFF_LIMIT)}\n[The diff is cut here: ${diff.length - DIFF_LIMIT} more characters.]`
    : diff
}
