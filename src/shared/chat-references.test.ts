import { describe, expect, it } from 'vitest'
import { expandPromptReferences, parseCodeReference } from './chat-references'

describe('parseCodeReference', () => {
  it('reads a file with a line or a line range', () => {
    expect(parseCodeReference('src/greeting.js:2')).toEqual({
      path: 'src/greeting.js',
      line: 2,
      endLine: null
    })
    expect(parseCodeReference('/abs/main.ts:10-14')).toEqual({
      path: '/abs/main.ts',
      line: 10,
      endLine: 14
    })
    expect(parseCodeReference('Makefile.am:3-3')).toEqual({
      path: 'Makefile.am',
      line: 3,
      endLine: null
    })
  })

  it('leaves other code alone', () => {
    for (const text of [
      '12:30',
      'a:b',
      'note:3',
      'npm test',
      'https://example.com:443',
      'file.ts:0',
      'file.ts'
    ])
      expect(parseCodeReference(text)).toBe(null)
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
