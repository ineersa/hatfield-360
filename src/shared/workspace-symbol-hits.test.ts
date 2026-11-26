import { describe, expect, it } from 'vitest'
import { rankSymbols, type WorkspaceSymbol } from './workspace-symbol-hits'

const CLASS = 5
const METHOD = 6
const FUNCTION = 12

const symbol = (
  name: string,
  kind: number,
  container: string | null,
  path: string,
  line: number | null = 10
): WorkspaceSymbol => ({ name, kind, container, path, line, column: line === null ? null : 5 })

const PROCESSOR = '/p/src/Pipeline/RunMessageProcessor.php'

// What Intelephense and a second server (phpactor) return for the same project, overlapping.
const intelephense = [
  symbol('RunMessageProcessor', CLASS, 'App\\Pipeline', PROCESSOR, 12),
  symbol('process', METHOD, 'RunMessageProcessor', PROCESSOR, 30),
  symbol('process', METHOD, 'ProcessRepository', '/p/src/ProcessRepository.php', 8),
  symbol('RunMessageProcessorTest', CLASS, 'Tests', '/p/tests/RunMessageProcessorTest.php', 9)
]
const phpactor = [
  symbol('RunMessageProcessor', CLASS, 'App\\Pipeline', PROCESSOR, 12),
  symbol('processAll', FUNCTION, null, '/p/src/functions.php', null)
]

const names = (hits: { name: string; container: string | null }[]) =>
  hits.map(({ name, container }) => (container === null ? name : `${container}::${name}`))

describe('rankSymbols', () => {
  it("merges every server's symbols, each once, the best name match first", () => {
    expect(names(rankSymbols('RunMessageProcessor', [intelephense, phpactor]))).toEqual([
      'App\\Pipeline::RunMessageProcessor',
      'Tests::RunMessageProcessorTest'
    ])
  })

  it('finds a method by its name alone, or in its class with ::', () => {
    // A class with "process" in its name follows the methods named so.
    expect(names(rankSymbols('process', [intelephense, phpactor]).slice(0, 3))).toEqual([
      'RunMessageProcessor::process',
      'ProcessRepository::process',
      'processAll'
    ])
    expect(names(rankSymbols('RunMessageProcessor::process', [intelephense]))).toEqual([
      'RunMessageProcessor::process'
    ])
    expect(names(rankSymbols('RunMessProc.proc', [intelephense]))).toEqual([
      'RunMessageProcessor::process'
    ])
    // gopls qualifies a method's name with its type and gives the package as its container.
    const gopls = [
      symbol('RunMessageProcessor.Process', METHOD, 'example.com/app/pipeline', PROCESSOR, 6)
    ]
    expect(names(rankSymbols('RunMessageProcessor.Process', [gopls]))).toEqual([
      'example.com/app/pipeline::RunMessageProcessor.Process'
    ])
  })

  it('keeps only classes for Go to Class, and marks the matched part of the name', () => {
    const [first, ...rest] = rankSymbols('RMP', [intelephense, phpactor], true)
    expect(first).toMatchObject({ name: 'RunMessageProcessor', line: 12, column: 5 })
    expect(first?.ranges).toEqual([
      [0, 1],
      [3, 4],
      [10, 11]
    ])
    expect(names(rest)).toEqual(['Tests::RunMessageProcessorTest'])
  })
})
