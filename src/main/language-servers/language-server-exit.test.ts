import { describe, expect, it } from 'vitest'
import { exitFailure } from './language-server-exit'

const exit = { refused: null, requested: false, code: 0, signal: null }

describe('exitFailure', () => {
  it('treats only a shutdown main asked for as clean', () => {
    expect(exitFailure('Go', { ...exit, requested: true })).toBeNull()
    expect(exitFailure('Go', { ...exit, requested: true, code: 1 })).toBeNull()
  })

  it('reports a server that exits on its own as failed, even with code 0', () => {
    expect(exitFailure('Go', exit)).toBe('The Go language server exited with code 0.')
    expect(exitFailure('Go', { ...exit, code: null, signal: 'SIGKILL' })).toBe(
      'The Go language server was killed (SIGKILL).'
    )
  })

  it('reports why main stopped a server that refused to start, though main stopped it', () => {
    expect(exitFailure('Go', { ...exit, requested: true, refused: 'Bad config' })).toBe(
      'Bad config'
    )
  })
})
