import { describe, expect, it } from 'vitest'
import { parseHatfieldCatalog } from './hatfield-catalog'
import { conversationKey } from '../../shared/recent-conversation'

const now = Date.parse('2026-11-26T00:00:00Z')

const response = {
  version: 1,
  scope: { cwd: '/projects/app' },
  sessions: [
    {
      sessionId: '7',
      displayTitle: 'Existing conversation',
      cwd: '/projects/app/nested',
      updatedAt: '2026-11-25T12:00:00Z'
    },
    {
      sessionId: '8',
      displayTitle: 'Old conversation',
      cwd: '/projects/app',
      updatedAt: '2026-11-01T00:00:00Z'
    }
  ],
  nextOffset: 2
}

describe('Hatfield catalog response', () => {
  it('keeps resume scope distinct from recorded cwd and expires old sessions', () => {
    const result = parseHatfieldCatalog(response, '/projects/app', now)
    expect(result).toEqual({
      sessions: [
        {
          provider: 'hatfield',
          providerSessionId: '7',
          title: 'Existing conversation',
          cwd: '/projects/app/nested',
          resumeCwd: '/projects/app',
          project: '/projects/app',
          branch: null,
          lastModified: 1795608000000
        }
      ],
      nextOffset: 2
    })
    const entry = result.sessions[0]
    if (!entry) throw new Error('Missing catalog entry')
    expect(conversationKey(entry)).toBe('["hatfield","7","/projects/app"]')
    expect(conversationKey({ ...entry, resumeCwd: '/projects/other' })).toBe(
      '["hatfield","7","/projects/other"]'
    )
  })

  it('rejects unsupported schema and malformed provider metadata', () => {
    expect(() => parseHatfieldCatalog({ ...response, version: 2 }, '/projects/app', now)).toThrow(
      'Invalid session:list response.'
    )
    expect(() =>
      parseHatfieldCatalog(
        { ...response, sessions: [{ ...response.sessions[0], sessionId: '--prompt=oops' }] },
        '/projects/app',
        now
      )
    ).toThrow('Invalid session:list session.')
    expect(() =>
      parseHatfieldCatalog(
        { ...response, sessions: [{ ...response.sessions[0], updatedAt: 'not-a-date' }] },
        '/projects/app',
        now
      )
    ).toThrow('Invalid session:list activity timestamp.')
  })
})
