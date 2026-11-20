import { describe, expect, it } from 'vitest'
import { descendantsInListing } from './process-tree'

describe('descendantsInListing', () => {
  it('finds every process below the shell, however deep, and nothing else', () => {
    const listing = [
      '    1     0',
      ' 4100     1', // the shell
      ' 4101  4100', // a job
      ' 4102  4101', // the job's child, in another process group
      ' 4103  4102',
      ' 4104  4100',
      ' 5000     1', // another terminal's shell
      ' 5001  5000',
      ''
    ].join('\n')
    expect(descendantsInListing(listing, 4100)).toEqual([4101, 4104, 4102, 4103])
  })

  it('finds nothing for a shell without children or one already gone', () => {
    expect(descendantsInListing(' 4100     1\n 5001  5000\n', 4100)).toEqual([])
    expect(descendantsInListing('', 4100)).toEqual([])
  })
})
