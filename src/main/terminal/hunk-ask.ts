import type { HunkAsk, HunkSessionView } from '../../shared/source-control-api'
import { hunkSessionIn, listHunkNotes, runHunk } from './hunk-notes'
import { askPrompt, type HunkQuestion, questionsIn, selectedHunk } from './hunk-questions'

/** The unanswered questions in the hunk selected in a session's view, or why there are none. */
async function questionsHere(hunk: string, session: string): Promise<HunkQuestion[] | string> {
  const [got, listed] = await Promise.all([
    runHunk(hunk, ['session', 'get', session, '--json']),
    listHunkNotes(hunk, session, 'all')
  ])
  const selected = got === null ? null : selectedHunk(got)
  if (selected === null) return 'No hunk selected'
  const questions = listed === null ? null : questionsIn(listed, selected)
  if (questions === null) return 'hunk did not list its notes'
  return questions.length === 0 ? 'No ? questions in this hunk' : questions
}

/** The hunk session running in a terminal, and how many questions its selected hunk holds. */
export async function hunkSessionView(hunk: string, terminalPid: number): Promise<HunkSessionView> {
  const session = await hunkSessionIn(hunk, terminalPid)
  if (session === null) return { session: null }
  const questions = await questionsHere(hunk, session)
  return typeof questions === 'string'
    ? { session, questions: 0, reason: questions }
    : { session, questions: questions.length, reason: null }
}

/** The chat message asking about the selected hunk's questions, or why there's nothing to ask. */
export async function askAboutHunk(
  hunk: string,
  terminalPid: number,
  root: string
): Promise<HunkAsk> {
  const session = await hunkSessionIn(hunk, terminalPid)
  if (session === null) return { status: 'none', reason: 'hunk isn’t running' }
  const questions = await questionsHere(hunk, session)
  return typeof questions === 'string'
    ? { status: 'none', reason: questions }
    : { status: 'ask', prompt: askPrompt(hunk, session, root, questions), count: questions.length }
}
