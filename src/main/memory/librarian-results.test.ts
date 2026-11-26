import { describe, expect, it } from 'vitest'
import { librarianDate, parseMemoryRecall, parseMemorySearch } from './librarian-results'

const CLAUDE_SESSION = '0aff2325-55c9-487a-abfe-69bb4349d6ce'

describe('parseMemorySearch', () => {
  it('keeps Librarian order, reads UTC stamps, infers the provider and skips malformed rows', () => {
    const parsed = parseMemorySearch({
      ok: true,
      results: [
        {
          kind: 'observation',
          id: '1ebd244f50e024f67b1ef33f9e81198c070e163e7693f5c6ba1316edd853920d',
          session_id: CLAUDE_SESSION,
          timestamp: '2026-11-24 15:00',
          content: 'completed: added the overflow test',
          importance: 'high'
        },
        { kind: 'observation', id: 'not-hex', session_id: '1', timestamp: '2026-11-24 15:00' },
        {
          kind: 'reflection',
          id: '0678e9156899c794a5901c90ba068f3b',
          session_id: '12',
          timestamp: '2026-11-22T00:03:05+00:00',
          content: 'Protocol v1 uses a Unix-domain socket.'
        },
        {
          kind: 'observation',
          id: 'abcdefabcdef',
          session_id: 'run-7',
          timestamp: '2026-11-21 02:05',
          content: '<b>plain</b>',
          importance: 'urgent'
        }
      ],
      partial: true
    })
    expect(parsed).toEqual({
      partial: true,
      hits: [
        {
          id: '1ebd244f50e024f67b1ef33f9e81198c070e163e7693f5c6ba1316edd853920d',
          kind: 'observation',
          sessionId: CLAUDE_SESSION,
          provider: 'claude',
          at: Date.UTC(2026, 10, 24, 15, 0),
          content: 'completed: added the overflow test',
          importance: 'high'
        },
        {
          id: '0678e9156899c794a5901c90ba068f3b',
          kind: 'reflection',
          sessionId: '12',
          provider: 'hatfield',
          at: Date.UTC(2026, 10, 22, 0, 3, 5),
          content: 'Protocol v1 uses a Unix-domain socket.',
          importance: null
        },
        {
          id: 'abcdefabcdef',
          kind: 'observation',
          sessionId: 'run-7',
          provider: null,
          at: Date.UTC(2026, 10, 21, 2, 5),
          content: '<b>plain</b>',
          importance: null
        }
      ]
    })
  })

  it('formats the date filter in UTC, as Librarian stores it', () => {
    expect(librarianDate(Date.UTC(2026, 10, 19, 7, 4, 59))).toBe('2026-11-19 07:04')
  })
})

describe('parseMemoryRecall', () => {
  it('condenses Claude and Hatfield journal events into speaker lines, skipping thinking and prompts', () => {
    const evidence = parseMemoryRecall({
      ok: true,
      events: [
        {
          type: 'run_started',
          created_at: '2026-11-21T02:00:00+00:00',
          payload: {
            step_id: 'start-1',
            payload: {
              system_prompt: '',
              messages: [
                { role: 'system', content: [{ type: 'text', text: 'You are a coding agent.' }] },
                {
                  role: 'user-context',
                  content: [{ type: 'text', text: '<agents_instructions>' }]
                },
                { role: 'user', content: [{ type: 'text', text: 'Plan the status protocol' }] }
              ]
            }
          }
        },
        {
          type: 'tool_execution_end',
          created_at: '2026-11-21T02:01:00+00:00',
          payload: {
            tool_result: {
              is_error: false,
              result: { tool_name: 'bash', content: [{ type: 'text', text: '/ 938G 771G' }] }
            }
          }
        },
        {
          seq: 660,
          type: 'assistant',
          created_at: '2026-11-24T15:00:16.799Z',
          payload: {
            message: {
              role: 'assistant',
              content: [
                { type: 'thinking', thinking: 'private' },
                {
                  type: 'tool_use',
                  name: 'Bash',
                  input: { command: 'pnpm test', description: 'Run the unit tests' }
                }
              ]
            }
          }
        },
        {
          type: 'user',
          created_at: '2026-11-24T15:00:20.000Z',
          payload: {
            message: {
              role: 'user',
              content: [{ type: 'tool_result', content: [{ type: 'text', text: '2 passed' }] }]
            }
          }
        },
        {
          type: 'llm_step_completed',
          created_at: '2026-11-21T02:04:05+00:00',
          payload: {
            assistant_message: {
              role: 'assistant',
              content: [
                { type: 'thinking', text: '' },
                { type: 'tool_call', tool_call_index: 0 },
                { type: 'text', text: 'Split into two tasks.' }
              ],
              tool_calls: [{ name: 'read', arguments: { path: '.agents/skills/testing/SKILL.md' } }]
            }
          }
        },
        {
          type: 'agent_command_applied',
          created_at: '2026-11-21T02:42:18+00:00',
          payload: {
            kind: 'follow_up',
            message: { role: 'user', content: [{ type: 'text', text: 'okay, implement it' }] }
          }
        },
        { type: 'run_started', payload: { model: 'x' } }
      ]
    })
    expect(evidence).toEqual([
      {
        at: Date.parse('2026-11-21T02:00:00+00:00'),
        speaker: 'user',
        text: 'Plan the status protocol'
      },
      { at: Date.parse('2026-11-21T02:01:00+00:00'), speaker: 'tool', text: '/ 938G 771G' },
      {
        at: Date.parse('2026-11-24T15:00:16.799Z'),
        speaker: 'tool',
        text: 'Bash: Run the unit tests'
      },
      { at: Date.parse('2026-11-24T15:00:20.000Z'), speaker: 'tool', text: '2 passed' },
      {
        at: Date.parse('2026-11-21T02:04:05+00:00'),
        speaker: 'tool',
        text: 'read: .agents/skills/testing/SKILL.md'
      },
      {
        at: Date.parse('2026-11-21T02:04:05+00:00'),
        speaker: 'assistant',
        text: 'Split into two tasks.'
      },
      { at: Date.parse('2026-11-21T02:42:18+00:00'), speaker: 'user', text: 'okay, implement it' }
    ])
  })
})
