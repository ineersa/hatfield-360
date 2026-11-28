import { describe, expect, it } from 'vitest'
import { noteCount, sessionAmong } from './hunk-session'

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

describe('noteCount', () => {
  it('counts the notes of `hunk session comment list --json`', () => {
    // Captured from hunk 0.25.0: a note typed with `c` on a removed line.
    const listed =
      '{"comments":[{"noteId":"user:1795830642118-1","source":"user","filePath":"a.txt","hunkIndex":0,"oldRange":[2,2],"body":"why uppercase?","author":"user","createdAt":"2026-11-28T01:50:42.118Z","editable":true}]}'
    expect(noteCount(listed)).toBe(1)
    expect(noteCount('{"comments":[]}')).toBe(0)
    expect(noteCount('No review notes.')).toBe(null)
  })
})
