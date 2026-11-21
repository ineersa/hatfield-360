import { describe, expect, it } from 'vitest'
import { fileCategory, folderCategory } from './lucide-icon-category'

describe('Lucide icon categories', () => {
  it('match a file by its whole name before its extension', () => {
    expect(fileCategory('tsconfig.json')).toBe('config')
    expect(fileCategory('pnpm-lock.yaml')).toBe('lock')
    expect(fileCategory('Dockerfile')).toBe('config')
    expect(fileCategory('package.json')).toBe('json')
  })

  it('match the longest extension first, in any case', () => {
    expect(fileCategory('index.TS')).toBe('code')
    expect(fileCategory('backup.tar.gz')).toBe('archive')
    expect(fileCategory('Cargo.lock')).toBe('lock')
    expect(fileCategory('photo.JPEG')).toBe('image')
  })

  it('treat env files as secrets', () => {
    expect(fileCategory('.env')).toBe('key')
    expect(fileCategory('.env.local')).toBe('key')
  })

  it('fall back to the plain file and folder', () => {
    expect(fileCategory('notes')).toBe('file')
    expect(fileCategory('archive.unknown-ext')).toBe('file')
    expect(folderCategory('random-name')).toBe('folder')
  })

  it('group known folders', () => {
    expect(folderCategory('.github')).toBe('git')
    expect(folderCategory('node_modules')).toBe('dependencies')
    expect(folderCategory('Tests')).toBe('tests')
    expect(folderCategory('dist')).toBe('build')
  })
})
