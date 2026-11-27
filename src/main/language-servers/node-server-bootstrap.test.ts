import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nodeServerArgs } from './node-server-bootstrap'

let folder: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'node-server-bootstrap-'))
})

afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

/** Runs `source` as a server script through the bootstrap, as main starts one. */
async function run(
  source: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const script = join(folder, 'server.js')
  await writeFile(script, source)
  const child = spawn(process.execPath, nodeServerArgs(script, ['--stdio']), {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  const code = await new Promise<number | null>((resolve) => child.once('close', resolve))
  return { code, stdout, stderr }
}

describe('nodeServerArgs', () => {
  it('runs the script with the arguments Node would give it', async () => {
    const result = await run('console.log(JSON.stringify(process.argv.slice(1)))')
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([join(folder, 'server.js'), '--stdio'])
  })

  it('prints the error and stack of an unhandled rejection and exits with code 1', async () => {
    const result = await run(
      'function index() { return Promise.reject(new TypeError("no base")) }\nindex()'
    )
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Unhandled rejection: TypeError: no base')
    expect(result.stderr).toMatch(/at index \(.*server\.js:1:\d+\)/)
  })

  it('prints a thrown value that is not an Error', async () => {
    const result = await run('setImmediate(() => { throw { reason: "bad state" } })')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain("Uncaught exception: { reason: 'bad state' }")
  })
})
