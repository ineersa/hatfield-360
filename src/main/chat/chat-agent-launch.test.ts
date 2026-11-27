import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { chatAgentCommand, writeClaudeShim } from './chat-agent-launch'

const execute = promisify(execFile)

it.skipIf(process.platform === 'win32')(
  'runs the whole profile with the adapter arguments after it, keeping shell startup output off stdout',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'claude-shim-'))
    try {
      const home = join(root, 'home')
      const script = join(root, 'claude.mjs')
      await mkdir(home)
      for (const startup of ['.bashrc', '.zshrc'])
        await writeFile(join(home, startup), 'echo startup-noise\n')
      await writeFile(script, 'console.log(JSON.stringify(process.argv.slice(2)))\n')
      const profile = { executable: process.execPath, args: [script, "it's wrapped", '~/x'] }
      const shim = await writeClaudeShim(profile, join(root, 'shims'))
      expect(await writeClaudeShim(profile, join(root, 'shims'))).toBe(shim)
      expect((await stat(shim)).mode & 0o777).toBe(0o700)
      const { stdout, stderr } = await execute(shim, ['--output-format', 'stream-json'], {
        cwd: root,
        env: { ...process.env, HOME: home }
      })
      expect(JSON.parse(stdout)).toEqual([
        "it's wrapped",
        expect.stringMatching(/[\\/]x$/),
        '--output-format',
        'stream-json'
      ])
      expect(stdout).not.toContain('startup-noise')
      expect(stderr).toContain('startup-noise')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
)

it('gives the adapter the profile environment but never an API key, which would bill the API', () => {
  const { env } = chatAgentCommand('/opt/claude', '1.0.0', {
    FOO: 'bar',
    ANTHROPIC_API_KEY: 'from-profile',
    CLAUDE_CODE_EXECUTABLE: '/elsewhere'
  })
  expect(env.FOO).toBe('bar')
  expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  expect(env.CLAUDE_CODE_EXECUTABLE).toBe('/opt/claude')
})
