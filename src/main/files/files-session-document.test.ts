import { describe, expect, it } from 'vitest'
import { EMPTY_FILES_SESSION } from '../../shared/files-session-api'
import { parseFilesSession, parseFilesSessions, withSession } from './files-session-document'

const view = { cursorState: [], viewState: { scrollLeft: 0 } }

describe('parseFilesSession', () => {
  it('keeps a well-formed session and drops the damaged parts inside it', () => {
    expect(
      parseFilesSession({
        expanded: ['/app', '', 7, '/app/src'],
        hideIgnored: true,
        tabs: [{ path: '/app/a.ts', view }, { path: '' }, 'b', { path: '/app/b.ts', view: [1] }],
        activePath: '/app/b.ts'
      })
    ).toEqual({
      expanded: ['/app', '/app/src'],
      hideIgnored: true,
      tabs: [
        { path: '/app/a.ts', view },
        { path: '/app/b.ts', view: null }
      ],
      activePath: '/app/b.ts'
    })
  })

  it('drops an active tab that is not open, and a view state too large to keep', () => {
    const huge = { cursorState: [], viewState: { padding: 'x'.repeat(200_000) } }
    expect(
      parseFilesSession({
        expanded: [],
        tabs: [{ path: '/app/a.ts', view: huge }],
        activePath: '/app/gone.ts'
      })
    ).toEqual({ ...EMPTY_FILES_SESSION, tabs: [{ path: '/app/a.ts', view: null }] })
  })

  it('refuses data that is not a session', () => {
    expect(parseFilesSession(null)).toBeNull()
    expect(parseFilesSession({ expanded: [] })).toBeNull()
    expect(parseFilesSession({ expanded: 'x', tabs: [] })).toBeNull()
  })
})

describe('withSession', () => {
  it('puts the saved workspace first, replacing its older session, and keeps the latest 50', () => {
    const sessions = Array.from(
      { length: 50 },
      (_, index): [string, typeof EMPTY_FILES_SESSION] => [`/w${index}`, EMPTY_FILES_SESSION]
    )
    const saved = { ...EMPTY_FILES_SESSION, hideIgnored: true }
    const updated = withSession(sessions, '/w10', saved)
    expect(updated).toHaveLength(50)
    expect(updated[0]).toEqual(['/w10', saved])
    expect(updated.filter(([key]) => key === '/w10')).toHaveLength(1)

    const added = withSession(sessions, '/new', saved)
    expect(added.map(([key]) => key)).toEqual([
      '/new',
      ...sessions.slice(0, 49).map(([key]) => key)
    ])
  })
})

describe('parseFilesSessions', () => {
  it('reads the stored sessions, leaving out unreadable ones', () => {
    expect(
      parseFilesSessions({
        version: 1,
        sessions: [
          { workspace: '', session: EMPTY_FILES_SESSION },
          { workspace: '/w.hatfield-workspace', session: { tabs: 'broken' } },
          { session: EMPTY_FILES_SESSION }
        ]
      })
    ).toEqual([['', EMPTY_FILES_SESSION]])
    expect(parseFilesSessions('nonsense')).toEqual([])
  })
})
