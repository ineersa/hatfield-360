import { posix, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fromStoredFolderPath, toStoredFolderPath } from './workspace-folder-paths'

describe('workspace folder paths', () => {
  it('stores folders inside the workspace file directory relative to it', () => {
    const file = '/home/me/repo/team.hatfield-workspace'
    expect(toStoredFolderPath('/home/me/repo', file, posix)).toBe('.')
    expect(toStoredFolderPath('/home/me/repo/packages/api', file, posix)).toBe('packages/api')
    expect(toStoredFolderPath('/home/me/repo/..hidden', file, posix)).toBe('..hidden')
  })

  it('stores folders outside the workspace file directory as absolute paths', () => {
    const file = '/home/me/repo/team.hatfield-workspace'
    expect(toStoredFolderPath('/home/me/other', file, posix)).toBe('/home/me/other')
    expect(toStoredFolderPath('/home/me', file, posix)).toBe('/home/me')
  })

  it('writes Windows relative paths with forward slashes and keeps other drives absolute', () => {
    const file = 'C:\\work\\repo\\team.hatfield-workspace'
    expect(toStoredFolderPath('C:\\work\\repo\\packages\\api', file, win32)).toBe('packages/api')
    expect(toStoredFolderPath('D:\\data', file, win32)).toBe('D:\\data')
    expect(fromStoredFolderPath('packages/api', file, win32)).toBe('C:\\work\\repo\\packages\\api')
  })

  it('resolves relative folders against wherever the workspace file now lives', () => {
    expect(fromStoredFolderPath('packages/api', '/mnt/moved/team.hatfield-workspace', posix)).toBe(
      '/mnt/moved/packages/api'
    )
    expect(
      fromStoredFolderPath('/home/me/other', '/mnt/moved/team.hatfield-workspace', posix)
    ).toBe('/home/me/other')
  })
})
