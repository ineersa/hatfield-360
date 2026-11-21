import { describe, expect, it } from 'vitest'
import { catppuccinIcon, fileIconName, folderIconName } from './catppuccin-icon-set'

describe('Catppuccin icon names', () => {
  it('match a file by its whole name before its extension', () => {
    expect(fileIconName('package.json')).toBe('package-json')
    expect(fileIconName('Dockerfile')).toBe('docker')
    expect(fileIconName('settings.json')).toBe('json')
  })

  it('match the longest extension first, in any case', () => {
    expect(fileIconName('index.ts')).toBe('typescript')
    expect(fileIconName('env.d.ts')).toBe('typescript-def')
    expect(fileIconName('README.MD')).toBe('readme')
    expect(fileIconName('Guide.MD')).toBe('markdown')
  })

  it('fall back to the plain file and folder', () => {
    expect(fileIconName('notes')).toBe('_file')
    expect(fileIconName('archive.unknown-ext')).toBe('_file')
    expect(folderIconName('random-name', false)).toBe('_folder')
    expect(folderIconName('random-name', true)).toBe('_folder_open')
  })

  it('give known folders their own closed and open icons', () => {
    expect(folderIconName('src', false)).toBe('folder_src')
    expect(folderIconName('Src', true)).toBe('folder_src_open')
    expect(catppuccinIcon('folder_src_open')).toBeDefined()
  })

  it('draw in the theme icon colours only', () => {
    const colours = new Set(JSON.stringify(catppuccinIcon('typescript')).match(/var\(--[\w-]+\)/g))
    expect([...colours]).toEqual(['var(--icon-blue)'])
  })
})
