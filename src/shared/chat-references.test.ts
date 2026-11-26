import { describe, expect, it } from 'vitest'
import { expandPromptReferences, findCodeReferences, parseCodeReference } from './chat-references'

const at = (
  path: string,
  line: number | null = null,
  endLine: number | null = null,
  column: number | null = null
) => ({ path, line, endLine, column })

describe('parseCodeReference', () => {
  it('reads a file alone, at a line, a range, a list, a column or a GitHub anchor', () => {
    expect(parseCodeReference('src/greeting.js')).toEqual(at('src/greeting.js'))
    expect(parseCodeReference('src/greeting.js:2')).toEqual(at('src/greeting.js', 2))
    expect(parseCodeReference('/abs/main.ts:10-14')).toEqual(at('/abs/main.ts', 10, 14))
    expect(parseCodeReference('Makefile.am:3-3')).toEqual(at('Makefile.am', 3))
    expect(parseCodeReference('src/foo.ts:12,40')).toEqual(at('src/foo.ts', 12))
    expect(parseCodeReference('src/foo.ts:12, 40, 7')).toEqual(at('src/foo.ts', 12))
    expect(parseCodeReference('src/foo.ts:12:5')).toEqual(at('src/foo.ts', 12, null, 5))
    expect(parseCodeReference('src/foo.ts#L12')).toEqual(at('src/foo.ts', 12))
    expect(parseCodeReference('src/foo.ts#L12-L20')).toEqual(at('src/foo.ts', 12, 20))
    expect(parseCodeReference('../lib/Dockerfile')).toEqual(at('../lib/Dockerfile'))
    expect(parseCodeReference('src/app/[id]/page.tsx:12')).toEqual(at('src/app/[id]/page.tsx', 12))
    expect(parseCodeReference('src/app/(auth)/page.tsx#L3')).toEqual(
      at('src/app/(auth)/page.tsx', 3)
    )
    expect(parseCodeReference('notes/a#b.md')).toEqual(at('notes/a#b.md'))
  })

  it('leaves other code alone', () => {
    for (const text of [
      '12:30',
      'a:b',
      'note:3',
      'npm test',
      'https://example.com:443',
      'https://example.com/a.ts',
      'file.ts:0',
      'v1.2',
      'greeting(name)',
      'C:3'
    ])
      expect(parseCodeReference(text)).toBe(null)
  })
})

const found = (text: string) =>
  findCodeReferences(text).map(({ start, end, reference }) => ({
    text: text.slice(start, end),
    reference
  }))

describe('findCodeReferences', () => {
  it('finds every form in prose, without the punctuation around it', () => {
    expect(
      found(
        'See src/greeting.js:2, src/main.js:1,3 and (README.md). Also lib/x.ts:4:2; a/b.ts#L3-L5.'
      )
    ).toEqual([
      { text: 'src/greeting.js:2', reference: at('src/greeting.js', 2) },
      { text: 'src/main.js:1,3', reference: at('src/main.js', 1) },
      { text: 'README.md', reference: at('README.md') },
      { text: 'lib/x.ts:4:2', reference: at('lib/x.ts', 4, null, 2) },
      { text: 'a/b.ts#L3-L5', reference: at('a/b.ts', 3, 5) }
    ])
  })

  it('keeps brackets inside a path, not around it', () => {
    expect(found('Routes: src/app/[id]/page.tsx:12 and (src/app/(auth)/page.tsx).')).toEqual([
      { text: 'src/app/[id]/page.tsx:12', reference: at('src/app/[id]/page.tsx', 12) },
      { text: 'src/app/(auth)/page.tsx', reference: at('src/app/(auth)/page.tsx') }
    ])
  })

  it('takes nothing from URLs, times or words', () => {
    expect(
      found('Open https://example.com/src/a.ts:3 at 12:30, a:b, version 1.2.3 or http://x.io.')
    ).toEqual([])
  })
})

describe('expandPromptReferences', () => {
  const context = {
    file: '/work/src/main.ts',
    selection: { start: 4, end: 6, text: 'const a = `x`\n```\nb' }
  }

  it('puts the shown file in for @file and the selection after the message for @selection', () => {
    expect(expandPromptReferences('Explain @selection in @file', context)).toEqual({
      ok: true,
      text: 'Explain `/work/src/main.ts:4-6` in `/work/src/main.ts`\n\n`/work/src/main.ts:4-6`:\n````\nconst a = `x`\n```\nb\n````'
    })
    expect(
      expandPromptReferences('(@selected)', {
        ...context,
        selection: { start: 2, end: 2, text: 'x' }
      })
    ).toEqual({
      ok: true,
      text: '(`/work/src/main.ts:2`)\n\n`/work/src/main.ts:2`:\n```\nx\n```'
    })
  })

  it('gives the caret line for @selection when nothing is selected, without text', () => {
    expect(
      expandPromptReferences('Why @selection?', {
        ...context,
        selection: { start: 9, end: 9, text: '' }
      })
    ).toEqual({ ok: true, text: 'Why `/work/src/main.ts:9`?' })
  })

  it('leaves emails and other words alone', () => {
    expect(expandPromptReferences('mail me@file.dev about @files', context)).toEqual({
      ok: true,
      text: 'mail me@file.dev about @files'
    })
  })

  it('refuses when the editor has nothing for a reference', () => {
    expect(expandPromptReferences('see @selection', { ...context, selection: null })).toEqual({
      ok: false,
      error: 'Nothing is selected in the editor.'
    })
    expect(expandPromptReferences('see @file', { file: null, selection: null })).toEqual({
      ok: false,
      error: 'No file is open in the editor.'
    })
  })
})
