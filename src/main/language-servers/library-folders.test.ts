import { describe, expect, it } from 'vitest'
import { isPythonLibraryFolder, libraryFoldersBesideHome } from './library-folders'

describe('libraryFoldersBesideHome', () => {
  it('drops home and every folder above it, and keeps folders inside or beside it', () => {
    const folders = ['/home/me', '/home', '/', '/home/me/go/pkg/mod', '/usr/lib/go', '/home/mel']
    expect(libraryFoldersBesideHome(folders, '/home/me')).toEqual([
      '/home/me/go/pkg/mod',
      '/usr/lib/go',
      '/home/mel'
    ])
  })
})

describe('isPythonLibraryFolder', () => {
  it("keeps Python's own folders in home and anything outside it", () => {
    const folders = [
      '/home/me/.pyenv/versions/3.12.1/lib/python3.12',
      '/home/me/.pyenv/versions/3.12.1/lib/python3.12/lib-dynload',
      '/home/me/.local/lib/python3.12/site-packages',
      '/home/me/app/.venv/lib/python3.12/site-packages',
      '/usr/lib/python3.12',
      '/opt/tools'
    ]
    expect(folders.filter((folder) => isPythonLibraryFolder(folder, '/home/me'))).toEqual(folders)
  })

  it('refuses other folders in home that PYTHONPATH names', () => {
    const folders = ['/home/me', '/home/me/.ssh', '/home/me/python3', '/home/me/notes/lib']
    expect(folders.filter((folder) => isPythonLibraryFolder(folder, '/home/me'))).toEqual([])
  })
})
