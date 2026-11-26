import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gitIgnoreRules, ignoreRules } from './ignore-rules'

describe('ignoreRules', () => {
  it('turns patterns into globs under their folder, anchored or at any depth', () => {
    const text = [
      '# build output',
      '/var/',
      '/.hatfield/cache-*/',
      '*.toon',
      'docs/gen',
      '!keep.php',
      '\\#notes   ',
      ''
    ].join('\n')
    expect(ignoreRules('/work/app', text)).toEqual([
      { base: '/work/app', pattern: 'var', globs: ['/work/app/var/**'] },
      {
        base: '/work/app',
        pattern: '.hatfield/cache-*',
        globs: ['/work/app/.hatfield/cache-*/**']
      },
      {
        base: '/work/app',
        pattern: '*.toon',
        globs: ['/work/app/**/*.toon', '/work/app/**/*.toon/**']
      },
      {
        base: '/work/app',
        pattern: 'docs/gen',
        globs: ['/work/app/docs/gen', '/work/app/docs/gen/**']
      },
      {
        base: '/work/app',
        pattern: '#notes',
        globs: ['/work/app/**/#notes', '/work/app/**/#notes/**']
      }
    ])
  })

  it("escapes glob characters in the folder's path", () => {
    expect(ignoreRules('/work/[app]', 'var/')[0]?.globs).toEqual(['/work/\\[app\\]/**/var/**'])
  })
})

describe('gitIgnoreRules', () => {
  let dir = ''
  let repo = ''
  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'ignore-rules-')))
    repo = join(dir, 'repo')
    const files: Record<string, string> = {
      '.gitignore': '/var/\n',
      'app/.gitignore': 'gen/\n',
      'app/src/Kernel.php': '<?php\n',
      'var/.gitignore': 'never-read\n'
    }
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(repo, path)), { recursive: true })
      await writeFile(join(repo, path), text)
    }
    execFileSync('git', ['init', '-q', repo])
    // The repository's own excludes file, in place of the user's.
    await writeFile(join(dir, 'user-ignore'), '*.log\n')
    execFileSync('git', ['-C', repo, 'config', 'core.excludesFile', join(dir, 'user-ignore')])
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  const ownPatterns = async (root: string) =>
    (await gitIgnoreRules(root))
      .filter((rule) => rule.base.startsWith(repo))
      .map((rule) => `${rule.base.slice(repo.length) || '/'} ${rule.pattern}`)

  it("reads the repository's .gitignore files, but not one in an ignored folder, and the user's", async () => {
    expect(await ownPatterns(repo)).toEqual(['/ var', '/app gen', '/ *.log'])
  })

  it('reads the .gitignore files above a folder inside the repository', async () => {
    expect((await ownPatterns(join(repo, 'app'))).toSorted()).toEqual([
      '/ *.log',
      '/ var',
      '/app gen'
    ])
  })

  it('has none outside a repository', async () => {
    await rm(join(repo, '.git'), { recursive: true })
    expect(await gitIgnoreRules(join(repo, 'app'))).toEqual([])
  })
})
