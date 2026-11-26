import { describe, expect, it } from 'vitest'
import { compareMatches, fuzzyPathMatch } from './fuzzy-path-match'

const PATHS = [
  'src/AgentCore/Application/Pipeline/RunMessageProcessor.php',
  'src/AgentCore/Application/Pipeline/RunMessageProcessorTest.php',
  'src/AgentCore/Application/Pipeline/MessageProcessor.php',
  'src/AgentCore/Domain/Run/RunMessage.php',
  'src/AgentCore/Infrastructure/Persistence/ProcessRepository.php',
  'tests/Unit/AgentCore/Pipeline/RunMessageProcessorTest.php',
  'src/renderer/src/components/chat/ChatMarkdown.tsx',
  'src/main/chat/chat-agent-host.ts',
  'README.md',
  'docs/product/vision.md'
]

/** The paths `query` finds, best first. */
const ranked = (query: string): string[] =>
  PATHS.flatMap((text) => {
    const match = fuzzyPathMatch(query, text)
    return match === null ? [] : [{ text, score: match.score }]
  })
    .toSorted(compareMatches)
    .map(({ text }) => text)

const highlighted = (query: string, text: string): string[] =>
  (fuzzyPathMatch(query, text)?.ranges ?? []).map(([start, end]) => text.slice(start, end))

describe('fuzzyPathMatch', () => {
  it('finds a file from a path fragment, camel humps or segment initials, best first', () => {
    for (const query of [
      'Pipeline/RunMessageProcessor',
      'RunMessageProcessor',
      'RunMessProc',
      'pipe/rmp',
      'rmp.php'
    ])
      expect(ranked(query)[0]).toBe('src/AgentCore/Application/Pipeline/RunMessageProcessor.php')
  })

  it('ranks a file name match over the same letters in its folders', () => {
    expect(ranked('chat')[0]).toBe('src/main/chat/chat-agent-host.ts')
    expect(ranked('vision')).toEqual(['docs/product/vision.md'])
    expect(ranked('ChatMd')[0]).toBe('src/renderer/src/components/chat/ChatMarkdown.tsx')
  })

  it('prefers the shorter path when two match as well', () => {
    expect(ranked('RunMessageProcessorTest')).toEqual([
      'tests/Unit/AgentCore/Pipeline/RunMessageProcessorTest.php',
      'src/AgentCore/Application/Pipeline/RunMessageProcessorTest.php'
    ])
  })

  it('marks the matched characters as ranges, on word starts where it can', () => {
    expect(
      highlighted('RunMessProc', 'src/AgentCore/Application/Pipeline/RunMessageProcessor.php')
    ).toEqual(['RunMess', 'Proc'])
    expect(
      highlighted('appmp', 'src/AgentCore/Application/Pipeline/RunMessageProcessor.php')
    ).toEqual(['Ap', 'P', 'M', 'P'])
    expect(highlighted('read me', 'README.md')).toEqual(['README'])
  })

  it('matches nothing for letters out of order, missing ones or an empty query', () => {
    expect(fuzzyPathMatch('rossecorp', 'src/RunMessageProcessor.php')).toBe(null)
    expect(fuzzyPathMatch('xyz', 'src/RunMessageProcessor.php')).toBe(null)
    expect(fuzzyPathMatch('  ', 'README.md')).toBe(null)
  })
})
