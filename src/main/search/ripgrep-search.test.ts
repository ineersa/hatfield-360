import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SEARCH_MATCH_LIMIT,
  type SearchFileResult,
  type SearchQuery
} from '../../shared/search-api'
import {
  fileMaskGlobs,
  parseRipgrepLine,
  ripgrepArgs,
  ripgrepError,
  startRipgrep
} from './ripgrep-search'

const query = (change: Partial<SearchQuery> = {}): SearchQuery => ({
  text: 'needle',
  regex: false,
  matchCase: false,
  wholeWord: false,
  fileMask: '',
  includeNonProject: false,
  scope: [],
  ...change
})

describe('ripgrepArgs', () => {
  it('searches plain text, ignoring case, leaving out dependency folders by default', () => {
    const args = ripgrepArgs(query(), ['/w/app'])
    expect(args).toContain('--fixed-strings')
    expect(args).toContain('--ignore-case')
    expect(args).toContain('--glob=!node_modules')
    expect(args).not.toContain('--no-ignore')
    expect(args.slice(-3)).toEqual(['--regexp=needle', '--', '/w/app'])
  })

  it('follows the options, and keeps a query starting with a dash from reading as an option', () => {
    const args = ripgrepArgs(
      query({
        text: '-v',
        regex: true,
        matchCase: true,
        wholeWord: true,
        includeNonProject: true,
        fileMask: '*.ts, !*.test.ts'
      }),
      ['/w/app', '/w/lib']
    )
    expect(args).not.toContain('--fixed-strings')
    expect(args).toEqual(
      expect.arrayContaining([
        '--case-sensitive',
        '--word-regexp',
        '--no-ignore',
        '--iglob=*.ts',
        '--iglob=!*.test.ts'
      ])
    )
    expect(args).not.toContain('--glob=!node_modules')
    expect(args.slice(-4)).toEqual(['--regexp=-v', '--', '/w/app', '/w/lib'])
  })

  it('reads a file mask as comma-separated globs', () => {
    expect(fileMaskGlobs(' *.ts ,, !dist/** , ! ')).toEqual(['*.ts', '!dist/**'])
  })
})

const match = (text: string, submatches: { start: number; end: number }[]) =>
  JSON.stringify({
    type: 'match',
    data: { path: { text: '/w/a.ts' }, lines: { text }, line_number: 3, submatches }
  })

describe('parseRipgrepLine', () => {
  it('turns byte offsets into editor columns', () => {
    // "héllo wörld " is 12 characters and 14 bytes.
    expect(parseRipgrepLine(match('héllo wörld needle\n', [{ start: 14, end: 20 }]))).toEqual({
      kind: 'match',
      path: '/w/a.ts',
      matches: [{ line: 3, start: 12, end: 18, text: 'héllo wörld needle', textStart: 0 }]
    })
  })

  it('cuts a very long line to the part around the match', () => {
    const line = `${'x'.repeat(1000)}needle${'y'.repeat(1000)}`
    const parsed = parseRipgrepLine(match(line, [{ start: 1000, end: 1006 }]))
    if (parsed?.kind !== 'match') throw new Error('Expected a match')
    const [found] = parsed.matches
    expect(found?.textStart).toBe(920)
    expect(found?.text).toHaveLength(400)
    expect(found?.text.slice(1000 - 920, 1006 - 920)).toBe('needle')
  })

  it("reads a file's end, and passes over other messages and paths that aren't text", () => {
    expect(parseRipgrepLine('{"type":"end","data":{"path":{"text":"/w/a.ts"}}}')).toEqual({
      kind: 'end',
      path: '/w/a.ts'
    })
    expect(parseRipgrepLine('{"type":"begin","data":{"path":{"text":"/w/a.ts"}}}')).toBeNull()
    expect(parseRipgrepLine('{"type":"match","data":{"path":{"bytes":"/w/=="}}}')).toBeNull()
    expect(parseRipgrepLine('not json')).toBeNull()
  })
})

describe('ripgrepError', () => {
  it('says what is wrong with a regex in one line', () => {
    expect(
      ripgrepError('rg: regex parse error:\n    (?:foo()\n    ^\nerror: unclosed group\n')
    ).toBe('Invalid regular expression: unclosed group')
    expect(ripgrepError('rg: /w/locked: Permission denied (os error 13)\n')).toBe(
      '/w/locked: Permission denied (os error 13)'
    )
  })
})

// Symlinks need extra rights on Windows, which isn't supported.
describe.skipIf(process.platform === 'win32')('startRipgrep', () => {
  let dir: string
  let app: string

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'ripgrep-search-')))
    app = join(dir, 'app')
    const outside = join(dir, 'outside')
    await mkdir(join(app, 'src'), { recursive: true })
    await mkdir(join(app, 'node_modules', 'lib'), { recursive: true })
    await mkdir(outside)
    execFileSync('git', ['init', '-q', app])
    await writeFile(join(app, '.gitignore'), '*.log\n')
    await writeFile(join(app, 'src', 'a.ts'), 'const x = 1\nconst needle = 2 // NEEDLE\n')
    await writeFile(join(app, 'build.log'), 'needle\n')
    await writeFile(join(app, 'node_modules', 'lib', 'index.js'), 'needle\n')
    await writeFile(join(outside, 'secret.txt'), 'needle\n')
    await symlink(outside, join(app, 'linked'))
  })

  afterEach(() => rm(dir, { recursive: true, force: true }))

  /** Runs a search to its end, with every result it sent. */
  const search = (
    change: Partial<SearchQuery>,
    paths = [app]
  ): Promise<{ files: SearchFileResult[]; limited: boolean; error: string | null }> =>
    new Promise((resolve) => {
      const files: SearchFileResult[] = []
      startRipgrep(query(change), paths, {
        results: (batch) => files.push(...batch),
        done: (limited, error) => resolve({ files, limited, error })
      })
    })
  const found = (files: SearchFileResult[]) =>
    files.map((file) => file.path.slice(app.length + 1)).toSorted()

  it("finds the project's own files, not ignored ones, dependencies or what a link points at", async () => {
    const { files, limited, error } = await search({})
    expect(found(files)).toEqual(['src/a.ts'])
    expect(files[0]?.matches.map(({ line, start, end }) => ({ line, start, end }))).toEqual([
      { line: 2, start: 6, end: 12 },
      { line: 2, start: 20, end: 26 }
    ])
    expect({ limited, error }).toEqual({ limited: false, error: null })
  })

  it('takes ignored files and dependencies in on request, still never through a link', async () => {
    const { files } = await search({ includeNonProject: true })
    expect(found(files)).toEqual(['build.log', 'node_modules/lib/index.js', 'src/a.ts'])
  })

  it('matches case, a file mask and a scope folder', async () => {
    expect(found((await search({ matchCase: true, text: 'NEEDLE' })).files)).toEqual(['src/a.ts'])
    expect(
      (await search({ matchCase: true, text: 'NEEDLE' })).files[0]?.matches.map((m) => m.start)
    ).toEqual([20])
    expect(found((await search({ includeNonProject: true, fileMask: '*.log' })).files)).toEqual([
      'build.log'
    ])
    expect(found((await search({}, [join(app, 'node_modules')])).files)).toEqual([
      'node_modules/lib/index.js'
    ])
  })

  it('stops at the match limit', async () => {
    await writeFile(join(app, 'many.txt'), 'needle\n'.repeat(SEARCH_MATCH_LIMIT + 50))
    const { files, limited } = await search({})
    expect(limited).toBe(true)
    expect(files.reduce((sum, file) => sum + file.matches.length, 0)).toBe(SEARCH_MATCH_LIMIT)
  })

  it('reports a bad regex', async () => {
    const { files, error } = await search({ regex: true, text: 'needle(' })
    expect(files).toEqual([])
    expect(error).toBe('Invalid regular expression: unclosed group')
  })
})
