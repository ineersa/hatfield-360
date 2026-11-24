import { expect, test } from 'vitest'
import { acceptsResumeArguments } from './resume-arguments'

test('rejects direct Claude prompts and competing selectors rather than replaying them', () => {
  expect(
    acceptsResumeArguments('claude', {
      executable: 'claude',
      args: ['--model', 'opus', 'send this']
    })
  ).toBe(false)
  expect(
    acceptsResumeArguments('claude', { executable: 'claude', args: ['--model', 'opus'] })
  ).toBe(true)
  expect(
    acceptsResumeArguments('claude', { executable: 'claude-wrapper', args: ['--from-pr=42'] })
  ).toBe(false)
})

test('preserves literal script arguments while rejecting Hatfield scope overrides', () => {
  const args = ['agent-scenario.mjs', 'hatfield', '7', 'literal $HOME; *']
  expect(acceptsResumeArguments('hatfield', { executable: 'node', args })).toBe(true)
  expect(
    acceptsResumeArguments('hatfield', { executable: 'node', args: [...args, '--cwd=/other'] })
  ).toBe(false)
})
