import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isPathInside } from '../files/path-containment'
import { pythonConfiguration } from './language-server-registry'

describe('pythonConfiguration', () => {
  let root: string

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'hatfield-python-root-')))
  })

  afterEach(() => rm(root, { recursive: true, force: true }))

  it("uses the project's virtualenv packages but never runs its interpreter", async () => {
    const venv = join(root, '.venv')
    const packages = join(venv, 'lib', 'python3.12', 'site-packages')
    await mkdir(packages, { recursive: true })
    await mkdir(join(venv, 'bin'))
    await writeFile(join(venv, 'bin', 'python'), '#!/bin/sh\ntouch "$0.ran"\n')
    await chmod(join(venv, 'bin', 'python'), 0o755)

    const { settings } = await pythonConfiguration(root)
    const python = settings?.['python']
    expect(python).toMatchObject({ analysis: { extraPaths: [packages] } })
    // The user's own interpreter, or none (a venv folder then stops basedpyright looking for one).
    const interpreter =
      typeof python === 'object' && python !== null && 'pythonPath' in python
        ? String(python.pythonPath)
        : root
    expect(isPathInside(interpreter, root) && interpreter !== root).toBe(false)
  })
})
