import { describe, expect, it } from 'vitest'
import {
  applyBatch,
  notesFileName,
  notesFromList,
  parseSavedNotes,
  savedNotesText,
  sessionAmong
} from './hunk-note-format'

// Captured from `hunk session comment list --type all --json` (hunk 0.25.0): a note typed with `c`
// on a removed line, and one an agent added with `hunk session comment add --rationale`.
const LISTED = JSON.stringify({
  comments: [
    {
      noteId: 'user:1795830642118-1',
      source: 'user',
      filePath: 'a.txt',
      hunkIndex: 0,
      oldRange: [2, 2],
      body: 'why uppercase?',
      author: 'user',
      createdAt: '2026-11-28T01:50:42.118Z',
      editable: true
    },
    {
      noteId: 'mcp:69a1f4f8-6214-4ae0-92f9-a1950bdd60ff',
      source: 'agent',
      filePath: 'f.txt',
      hunkIndex: 0,
      newRange: [1, 1],
      body: 'test note\n\nwhy',
      createdAt: '2026-11-28T01:45:07.303Z',
      editable: false
    }
  ]
})

describe('notesFromList', () => {
  it('keeps where each note was, what it said and who wrote it', () => {
    expect(notesFromList(LISTED)).toEqual([
      { filePath: 'a.txt', side: 'old', line: 2, text: 'why uppercase?', author: 'user' },
      { filePath: 'f.txt', side: 'new', line: 1, text: 'test note\n\nwhy' }
    ])
    expect(notesFromList('{"comments":[]}')).toEqual([])
  })

  it('leaves out notes it could not put back, and refuses what is not a list', () => {
    const odd = JSON.stringify({
      comments: [
        { filePath: 'a.txt', body: 'on a whole hunk', hunkIndex: 0 },
        { filePath: 'a.txt', body: '', newRange: [1, 1] },
        { filePath: 'a.txt', body: 'line zero', newRange: [0, 0] },
        { body: 'no file', newRange: [1, 1] }
      ]
    })
    expect(notesFromList(odd)).toEqual([])
    expect(notesFromList('not json')).toBe(null)
    expect(notesFromList('{"notes":[]}')).toBe(null)
  })
})

describe('saved notes', () => {
  it('read back as they were written, and go back to hunk as one apply batch', () => {
    const notes = notesFromList(LISTED) ?? []
    expect(parseSavedNotes(savedNotesText(notes))).toEqual(notes)
    expect(JSON.parse(applyBatch(notes))).toEqual({
      comments: [
        { filePath: 'a.txt', oldLine: 2, summary: 'why uppercase?', author: 'user' },
        { filePath: 'f.txt', newLine: 1, summary: 'test note\n\nwhy' }
      ]
    })
  })

  it('read nothing from a damaged or foreign file', () => {
    expect(parseSavedNotes('')).toEqual([])
    expect(parseSavedNotes('{"version":2,"notes":[]}')).toEqual([])
    expect(
      parseSavedNotes(
        JSON.stringify({
          version: 1,
          notes: [
            { filePath: 'a.txt', side: 'both', line: 1, text: 'x' },
            { filePath: 'a.txt', side: 'new', line: -1, text: 'x' },
            { filePath: 'a.txt', side: 'new', line: 3, text: 'kept' }
          ]
        })
      )
    ).toEqual([{ filePath: 'a.txt', side: 'new', line: 3, text: 'kept' }])
  })
})

describe('sessionAmong', () => {
  // Trimmed from `hunk session list --json` (hunk 0.25.0).
  const sessions = JSON.stringify({
    sessions: [
      { sessionId: 'other', pid: 100, cwd: '/a', title: 'Patch review' },
      { sessionId: '7269adad-a99a-47ca-aa13-18f5a3b0004b', pid: 1959408, cwd: '/b' }
    ]
  })

  it("finds the session whose hunk is one of the terminal's processes", () => {
    expect(sessionAmong(sessions, new Set([1959400, 1959408]))).toBe(
      '7269adad-a99a-47ca-aa13-18f5a3b0004b'
    )
    expect(sessionAmong(sessions, new Set([5]))).toBe(null)
    expect(sessionAmong('No active Hunk sessions.', new Set([100]))).toBe(null)
  })
})

describe('notesFileName', () => {
  it('names each review apart, as a plain file name', () => {
    const name = notesFileName(['/repo', 'branch', 'main', 'feature'])
    expect(name).toMatch(/^[0-9a-f]{64}\.json$/)
    expect(notesFileName(['/repo', 'branch', 'main', 'other'])).not.toBe(name)
  })
})
