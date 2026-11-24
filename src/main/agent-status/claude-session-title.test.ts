import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { claudeSessionTitle } from './claude-session-title'

test('reads the exact Claude conversation title, never a prompt, and follows a custom rename', async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'h360-claude-title-'))
  const cwd = join(root, 'project')
  const config = join(root, 'config')
  const project = join(config, 'projects', cwd.replace(/[^a-z0-9]/gi, '-'))
  const id = 'd3c962f8-2480-49c2-8ab4-c2bb301fb201'
  const transcript = join(project, `${id}.jsonl`)
  const previous = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = config
  try {
    await mkdir(cwd)
    await mkdir(project, { recursive: true })
    await writeFile(
      transcript,
      `${JSON.stringify({
        type: 'user',
        uuid: '5e543980-d8db-4063-879a-7d08cdf1c5a6',
        sessionId: id,
        cwd,
        timestamp: '2026-11-20T00:00:00Z',
        message: { role: 'user', content: 'Private first prompt' }
      })}\n`
    )
    expect(await claudeSessionTitle(id, cwd)).toBeNull()
    await appendFile(
      transcript,
      `${JSON.stringify({ type: 'ai-title', sessionId: id, aiTitle: 'Generated title' })}\n`
    )
    expect(await claudeSessionTitle(id, cwd)).toBe('Generated title')
    await appendFile(
      transcript,
      `${JSON.stringify({ type: 'custom-title', sessionId: id, customTitle: 'Chosen title' })}\n`
    )
    expect(await claudeSessionTitle(id, cwd)).toBe('Chosen title')
    expect(await claudeSessionTitle('d3c962f8-2480-49c2-8ab4-c2bb301fb202', cwd)).toBeNull()
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previous
    await rm(root, { recursive: true, force: true })
  }
})
