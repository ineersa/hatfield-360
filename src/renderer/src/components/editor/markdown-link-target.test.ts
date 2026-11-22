import { describe, expect, it } from 'vitest'
import { headingSlug, innermostRoot, markdownLinkTarget } from './markdown-link-target'

const from = '/work/app/docs/guide.md'

describe('Markdown link targets', () => {
  it('keep web links as they are', () => {
    expect(markdownLinkTarget('https://example.com/a?b#c', from, '/work/app')).toEqual({
      kind: 'web',
      url: 'https://example.com/a?b#c'
    })
  })

  it('lead nowhere for other schemes and protocol-relative links', () => {
    for (const href of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'mailto:a@b.c',
      '//evil.com/x'
    ])
      expect(markdownLinkTarget(href, from, '/work/app')).toBeNull()
  })

  it('find headings in the same file', () => {
    expect(markdownLinkTarget('#set-up%20here', from, null)).toEqual({
      kind: 'heading',
      slug: 'set-up here'
    })
    expect(markdownLinkTarget('#', from, null)).toBeNull()
  })

  it('resolve paths against the file folder, with their heading', () => {
    expect(markdownLinkTarget('../README.md#install', from, '/work/app')).toEqual({
      kind: 'file',
      path: '/work/app/README.md',
      slug: 'install'
    })
    expect(markdownLinkTarget('./api/my%20notes.md?plain=1', from, null)).toEqual({
      kind: 'file',
      path: '/work/app/docs/api/my notes.md',
      slug: null
    })
    expect(markdownLinkTarget('../../../../../etc/hosts', from, null)).toEqual({
      kind: 'file',
      path: '/etc/hosts',
      slug: null
    })
  })

  it('resolve paths from the workspace folder when they start with a slash', () => {
    expect(markdownLinkTarget('/src/index.ts', from, '/work/app')).toEqual({
      kind: 'file',
      path: '/work/app/src/index.ts',
      slug: null
    })
    expect(markdownLinkTarget('/src/index.ts', from, null)).toBeNull()
  })

  it('keep Windows paths in their own form', () => {
    expect(markdownLinkTarget('../src/a.ts', 'C:\\work\\app\\docs\\guide.md', null)).toEqual({
      kind: 'file',
      path: 'C:\\work\\app\\src\\a.ts',
      slug: null
    })
    expect(markdownLinkTarget('../../../x.md', 'C:\\work\\guide.md', null)).toEqual({
      kind: 'file',
      path: 'C:\\x.md',
      slug: null
    })
  })
})

describe('the root of a linked file', () => {
  it('is the innermost workspace folder or worktree holding it', () => {
    const roots = ['/work/app', '/work/app/.worktrees/fix', '/elsewhere/app-feature']
    expect(innermostRoot('/work/app/.worktrees/fix/README.md', roots)).toBe(
      '/work/app/.worktrees/fix'
    )
    expect(innermostRoot('/work/app/README.md', roots)).toBe('/work/app')
    expect(innermostRoot('/elsewhere/app-feature/docs/a.md', roots)).toBe('/elsewhere/app-feature')
    expect(innermostRoot('/work/application/README.md', roots)).toBeNull()
  })
})

describe('heading slugs', () => {
  it('follow GitHub anchors, numbering repeats', () => {
    const seen = new Map<string, number>()
    expect(headingSlug('Set up: the `pnpm` way!', seen)).toBe('set-up-the-pnpm-way')
    expect(headingSlug('Überblick & Ziele', seen)).toBe('überblick--ziele')
    expect(headingSlug('Notes', seen)).toBe('notes')
    expect(headingSlug('Notes', seen)).toBe('notes-1')
  })
})
