import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, realpath, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { chatAgentCommand, writeClaudeShim } from './chat-agent-launch'

/** Bash with startup files, whatever the developer's own shell is. */
const BASH = { file: '/bin/bash', args: [] }

function run(
  file: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; input: string }
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: options.cwd, env: options.env })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({ stdout, stderr, code }))
    child.stdin.end(options.input)
  })
}

async function withRoot(test: (root: string) => Promise<void>): Promise<void> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'claude-shim-')))
  try {
    await test(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe.skipIf(process.platform === 'win32')('writeClaudeShim', () => {
  it('runs the whole profile in the session folder, untouched by what shell startup files do', async () => {
    await withRoot(async (root) => {
      const home = join(root, 'home')
      const session = join(root, 'session')
      const script = join(root, 'claude.mjs')
      await mkdir(home)
      await mkdir(session)
      // Each line is something real startup files do: print, export a key, cd, prompt for input.
      await writeFile(
        join(home, '.bashrc'),
        'echo startup-noise\nexport ANTHROPIC_API_KEY=from-startup\ncd /\nread -r eaten || true\n'
      )
      await writeFile(
        script,
        `import { readFileSync } from 'node:fs'
console.log(JSON.stringify({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  key: process.env.ANTHROPIC_API_KEY ?? null,
  stdin: readFileSync(0, 'utf8')
}))\n`
      )
      const profile = { executable: process.execPath, args: [script, "it's wrapped", '~/x'] }
      const shim = await writeClaudeShim(profile, join(root, 'shims'), BASH)
      expect((await stat(shim)).mode & 0o777).toBe(0o700)
      const { stdout, stderr, code } = await run(shim, ['--output-format', 'stream-json'], {
        cwd: session,
        env: { ...process.env, HOME: home },
        input: '{"protocol":"first message"}\n'
      })
      expect(code).toBe(0)
      expect(JSON.parse(stdout)).toEqual({
        args: ["it's wrapped", expect.stringMatching(/[\\/]x$/), '--output-format', 'stream-json'],
        cwd: session,
        key: null,
        stdin: '{"protocol":"first message"}\n'
      })
      expect(stderr).toContain('startup-noise')
    })
  })

  it('gives concurrent writers of one profile the same file, and removes week-old shims of other profiles', async () => {
    await withRoot(async (root) => {
      const shims = join(root, 'shims')
      const old = await writeClaudeShim({ executable: 'old-claude', args: ['-x'] }, shims, BASH)
      const weekAgo = new Date(Date.UTC(2020, 0, 1))
      await utimes(old, weekAgo, weekAgo)
      const recent = join(shims, 'claude-0123456789abcdef')
      const unrelated = join(shims, 'notes.txt')
      await writeFile(recent, '')
      await writeFile(unrelated, '')
      const profile = { executable: 'claude', args: ['--verbose'] }
      const written = await Promise.all(
        Array.from({ length: 8 }, () => writeClaudeShim(profile, shims, BASH))
      )
      expect(new Set(written).size).toBe(1)
      expect(new Set(await readdir(shims))).toEqual(
        new Set([written[0], recent, unrelated].map((path) => path?.slice(shims.length + 1)))
      )
    })
  })
})

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
