import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { listClaudeCatalog } from './claude-catalog'

async function writeSession(
  config: string,
  cwd: string,
  sessionId: string,
  title: string,
  modified: string
) {
  const directory = join(config, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))
  await mkdir(directory, { recursive: true })
  const file = join(directory, `${sessionId}.jsonl`)
  await writeFile(
    file,
    [
      {
        type: 'user',
        isSidechain: false,
        sessionId,
        cwd,
        timestamp: '2025-01-01T00:00:00Z',
        uuid: '12345678-1234-4234-8234-123456789abc',
        message: { role: 'user', content: 'original prompt' }
      },
      { type: 'custom-title', sessionId, customTitle: title }
    ]
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n'
  )
  const date = new Date(modified)
  await utimes(file, date, date)
}

test('loads existing Claude sessions and filters by workspace scope and provider activity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'claude-catalog-'))
  const previous = process.env.CLAUDE_CONFIG_DIR
  const config = join(root, 'config')
  process.env.CLAUDE_CONFIG_DIR = config
  try {
    const project = join(root, 'project')
    const unrelated = join(root, 'unrelated')
    await mkdir(project)
    await mkdir(unrelated)
    const recent = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    await writeSession(config, project, recent, 'Actual renamed session', '2025-02-06T00:00:00Z')
    await writeSession(
      config,
      project,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'Expired',
      '2025-01-01T00:00:00Z'
    )
    await writeSession(
      config,
      unrelated,
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'Outside workspace',
      '2025-02-06T00:00:00Z'
    )
    const results = await listClaudeCatalog(
      [{ kind: 'project', path: project, missing: false, name: 'project', multiRepo: false }],
      [],
      Date.parse('2025-02-07T00:00:00Z')
    )
    expect(results).toEqual([
      {
        provider: 'claude',
        providerSessionId: recent,
        project,
        cwd: project,
        title: 'Actual renamed session',
        branch: null,
        lastModified: Date.parse('2025-02-06T00:00:00Z')
      }
    ])
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previous
    await rm(root, { recursive: true, force: true })
  }
})
