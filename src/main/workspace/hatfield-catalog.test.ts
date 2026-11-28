import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  hatfieldCatalogCommand,
  isMissingHatfieldCatalog,
  listHatfieldCatalog,
  parseHatfieldCatalog
} from './hatfield-catalog'
import { conversationKey, matchingConversationKeys } from '../../shared/recent-conversation'
import type { AgentProfile } from '../../shared/agent-api'

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
      { executable: 'php', args: ['/Applications/Hatfield Tools/hatfield.phar'], env: {} },
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
        missing: false,
        multiRepo: false
      })),
      [],
      { executable: 'php', args: ['/unused/hatfield.phar'], env: {} },
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

async function withProject(
  run: (project: string, folders: Parameters<typeof listHatfieldCatalog>[0]) => Promise<void>
) {
  const project = await realpath(await mkdtemp(join(tmpdir(), 'hatfield-command-')))
  try {
    await run(project, [
      { name: 'app', path: project, kind: 'project', missing: false, multiRepo: false }
    ])
  } finally {
    await rm(project, { recursive: true, force: true })
  }
}

// Bash without startup files, so the developer's own shell and its startup output don't matter.
const read = (folders: Parameters<typeof listHatfieldCatalog>[0], profile: AgentProfile) =>
  listHatfieldCatalog(folders, [], profile, undefined, { file: '/bin/bash', args: ['--norc'] })

describe('listHatfieldCatalog with a real command', () => {
  it('runs the profile with its environment and a home-relative argument', async () => {
    await withProject(async (project, folders) => {
      const script = join(project, 'session-list.mjs')
      await writeFile(
        script,
        `const cwd = process.argv[process.argv.indexOf('--cwd') + 1];
console.log(JSON.stringify({ version: 1, scope: { cwd }, nextOffset: null, sessions: [{
  sessionId: '1', cwd, updatedAt: new Date().toISOString(),
  displayTitle: process.env.PROFILE_SENTINEL + ' ' + process.argv[2]
}] }))\n`
      )
      const result = await read(folders, {
        executable: process.execPath,
        args: [script, '~/tilde'],
        env: { PROFILE_SENTINEL: 'from-profile' }
      })
      expect(result.errors).toEqual([])
      expect(result.sessions.map(({ title }) => title)).toEqual([
        `from-profile ${join(homedir(), 'tilde')}`
      ])
    })
  })

  it('names why the command failed instead of a bare could-not-read', async () => {
    await withProject(async (project, folders) => {
      const missing = await read(folders, {
        executable: join(project, 'missing-hatfield'),
        args: [],
        env: {}
      })
      expect(missing.errors).toHaveLength(1)
      expect(missing.errors[0]).toMatch(
        /^Hatfield: could not read the hatfield-command-\w+ catalog \(the configured command could not be started, exit 127: .*missing-hatfield.*\)\.$/
      )
      const noisy = join(project, 'noisy.mjs')
      await writeFile(noisy, "console.log('Welcome back!')\n")
      const notJson = await read(folders, {
        executable: process.execPath,
        args: [noisy],
        env: {}
      })
      expect(notJson.errors).toEqual([
        `Hatfield: could not read the ${basename(project)} catalog (its output is not session:list JSON; does a shell startup file print?).`
      ])
      const failing = join(project, 'failing.mjs')
      await writeFile(failing, "console.error('database is locked'); process.exit(3)\n")
      const failed = await read(folders, {
        executable: process.execPath,
        args: [failing],
        env: {}
      })
      expect(failed.errors).toEqual([
        `Hatfield: could not read the ${basename(project)} catalog (exit 3: database is locked).`
      ])
    })
  })
})
