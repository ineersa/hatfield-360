import { mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  hatfieldCatalogCommand,
  isMissingHatfieldCatalog,
  listHatfieldCatalog,
  parseHatfieldCatalog
} from './hatfield-catalog'
import { conversationKey, matchingConversationKeys } from '../../shared/recent-conversation'

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
  it('treats only the missing session table as an empty catalog', () => {
    expect(
      isMissingHatfieldCatalog(
        Object.assign(new Error('Command failed'), {
          stderr: 'SQLSTATE[HY000]: General error: 1 no such table: hatfield_session'
        })
      )
    ).toBe(true)
    expect(
      isMissingHatfieldCatalog(
        Object.assign(new Error('Command failed'), {
          stderr: 'SQLSTATE[HY000]: General error: 1 no such table: other_table'
        })
      )
    ).toBe(false)
    expect(
      isMissingHatfieldCatalog(
        Object.assign(new Error('Command failed'), {
          stderr: 'SQLSTATE[HY000]: database is locked'
        })
      )
    ).toBe(false)
    expect(isMissingHatfieldCatalog(new Error('spawn hatfield ENOENT'))).toBe(false)
  })

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

it('appends listing arguments to the configured PHP phar prefix inside the agent shell', () => {
  expect(
    hatfieldCatalogCommand(
      { executable: 'php', args: ['/Applications/Hatfield Tools/hatfield.phar'] },
      '/projects/app',
      '2026-11-12T00:00:00.000Z',
      200,
      { file: '/bin/zsh', args: ['-l'] }
    )
  ).toEqual({
    file: '/bin/zsh',
    args: [
      '-l',
      '-ic',
      'cd -- "$1" && shift && exec -- "$@"',
      'hatfield-360',
      '/projects/app',
      'php',
      '/Applications/Hatfield Tools/hatfield.phar',
      'session:list',
      '--json',
      '--cwd',
      '/projects/app',
      '--since',
      '2026-11-12T00:00:00.000Z',
      '--limit',
      '200',
      '--offset',
      '200'
    ]
  })
})

it('matches canonical and symlinked Hatfield keys without merging distinct numeric ID scopes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hatfield-scope-'))
  try {
    const alias = join(root, 'linked')
    await symlink(root, alias)
    const canonical = await realpath(alias)
    const identity = { provider: 'hatfield', providerSessionId: '42', cwd: canonical } as const
    const keys = matchingConversationKeys(identity, new Map([[alias, canonical]]))
    expect([...keys]).toEqual([
      JSON.stringify(['hatfield', '42', canonical]),
      JSON.stringify(['hatfield', '42', alias])
    ])
    expect(keys.has(JSON.stringify(['hatfield', '42', join(root, 'other')]))).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('reports each missing catalog directory separately without starting the configured command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hatfield-missing-'))
  try {
    const result = await listHatfieldCatalog(
      ['removed-worktree', 'moved-project'].map((name) => ({
        name,
        path: join(root, name),
        kind: 'project',
        missing: false
      })),
      [],
      { executable: 'php', args: ['/unused/hatfield.phar'] },
      now
    )
    expect(result.errors).toEqual([
      'Hatfield: the removed-worktree catalog folder is unavailable.',
      'Hatfield: the moved-project catalog folder is unavailable.'
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
