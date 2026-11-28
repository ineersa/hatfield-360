import { describe, expect, it } from 'vitest'
import { askPrompt, questionsIn, selectedHunk } from './hunk-questions'

// Shaped as hunk 0.25.0 lists notes (`session comment list --type all --json`): the user's notes
// typed with `c`, a reply with `parentId`, an agent's note.
const note = (fields: Record<string, unknown>) => ({
  noteId: 'user:1795830642118-1',
  source: 'user',
  filePath: 'a.txt',
  hunkIndex: 0,
  newRange: [2, 2],
  body: 'why uppercase?',
  author: 'user',
  createdAt: '2026-11-28T01:50:42.118Z',
  editable: true,
  ...fields
})
const LISTED = JSON.stringify({
  comments: [
    note({ noteId: 'user:1', body: '? why not a Map here' }),
    note({ noteId: 'user:2', body: '  ?', oldRange: [3, 4], newRange: undefined }),
    note({ noteId: 'user:3', body: 'rename this' }),
    note({ noteId: 'user:4', body: 'is this right? not sure' }),
    note({ noteId: 'user:5', body: '? already answered' }),
    note({
      noteId: 'mcp:a:0',
      parentId: 'user:5',
      source: 'agent',
      body: 'Yes.',
      author: 'Hatfield chat',
      editable: false
    }),
    note({ noteId: 'user:6', parentId: 'mcp:x:0', body: '? a reply, not a question' }),
    note({ noteId: 'mcp:b:0', source: 'agent', body: '? an agent note' }),
    note({ noteId: 'user:7', body: '? in another hunk', hunkIndex: 1 }),
    note({ noteId: 'user:8', body: '? in another file', filePath: 'b.txt' })
  ]
})

describe('questionsIn', () => {
  it("picks the user's unanswered `?` notes in the selected hunk", () => {
    expect(questionsIn(LISTED, { filePath: 'a.txt', hunkIndex: 0 })).toEqual([
      {
        noteId: 'user:1',
        filePath: 'a.txt',
        side: 'new',
        range: [2, 2],
        text: 'why not a Map here'
      },
      {
        noteId: 'user:2',
        filePath: 'a.txt',
        side: 'old',
        range: [3, 4],
        text: 'Explain what this code does and why it is written this way.'
      }
    ])
    expect(questionsIn(LISTED, { filePath: 'a.txt', hunkIndex: 1 })?.map((q) => q.noteId)).toEqual([
      'user:7'
    ])
    expect(questionsIn('No live comments.', { filePath: 'a.txt', hunkIndex: 0 })).toBe(null)
  })
})

describe('selectedHunk', () => {
  it('reads the selection from `hunk session get --json`', () => {
    // Trimmed from hunk 0.25.0.
    const got =
      '{"session":{"sessionId":"666e89f5-c7f4-4fd3-82ee-ec7e63ab0dd1","pid":2830050,"files":[{"id":"/r:0:a.txt","path":"a.txt","additions":2,"deletions":1,"hunkCount":1}],"snapshot":{"updatedAt":"2026-11-28T03:04:52.341Z","state":{"selectedFileId":"/r:0:a.txt","selectedFilePath":"a.txt","selectedHunkIndex":0,"selectedHunkOldRange":[1,3],"selectedHunkNewRange":[1,4]}}}}'
    expect(selectedHunk(got)).toEqual({ filePath: 'a.txt', hunkIndex: 0 })
    expect(selectedHunk('{"session":{"snapshot":{"state":{"selectedHunkIndex":0}}}}')).toBe(null)
  })
})

describe('askPrompt', () => {
  it('carries the session, each question with its place and note id, and the reply command', () => {
    const questions = questionsIn(LISTED, { filePath: 'a.txt', hunkIndex: 0 }) ?? []
    const prompt = askPrompt('/home/me/my tools/hunk', 'sess-1', questions)
    expect(prompt).toContain('session sess-1')
    expect(prompt).toContain('1. a.txt, line 2 (note user:1):\n   why not a Map here')
    expect(prompt).toContain('2. a.txt, lines 3-4 of the old version')
    expect(prompt).toContain(
      `PATH='/home/me/my tools':"$PATH" '/home/me/my tools/hunk' session comment apply sess-1 --stdin <<'ANSWERS'`
    )
    expect(prompt).toContain('"replyTo": "user:2"')
    expect(prompt).toContain("don't change any files")
  })
})
