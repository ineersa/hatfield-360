import { describe, expect, it } from 'vitest'
import { multiRepoServerRoot } from './language-server-root'

describe('multiRepoServerRoot', () => {
  const folder = '/home/me/projects'
  const trees = [
    '/home/me/projects/app',
    '/home/me/projects/app-worktrees/feature',
    '/home/me/projects/lib'
  ]

  it('roots a file in a repository at that repository', () => {
    expect(multiRepoServerRoot('/home/me/projects/app/src/A.php', folder, trees)).toBe(
      '/home/me/projects/app'
    )
  })

  it('roots a file in a linked worktree at the worktree, not the folder holding it', () => {
    expect(
      multiRepoServerRoot('/home/me/projects/app-worktrees/feature/src/A.php', folder, trees)
    ).toBe('/home/me/projects/app-worktrees/feature')
  })

  it('roots a file in a plain subfolder at that subfolder', () => {
    expect(multiRepoServerRoot('/home/me/projects/scripts/tool/run.php', folder, trees)).toBe(
      '/home/me/projects/scripts'
    )
  })

  it('gives no root to a file directly in the folder', () => {
    expect(multiRepoServerRoot('/home/me/projects/stray.php', folder, trees)).toBeNull()
  })
})
