import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openLogFile } from '../logs/log-file'
import { stallBetween } from './main-stalls'
import { PerformanceLog, slowHandlerLine, slowTaskLine, stallLine } from './performance-log'

const now = new Date('2026-11-28T10:00:00.000Z')

describe('slowTaskLine', () => {
  it('names the duration, view, last action and blamed scripts', () => {
    expect(
      slowTaskLine(
        {
          duration: 1234.4,
          view: 'agents',
          action: { label: 'click "Close index.ts"', before: 15.6 },
          scripts: [
            { invoker: 'DOMWindow.onclick', source: 'fit @ index.js:120', duration: 900 },
            { invoker: 'TimerHandler:setTimeout', source: 'anonymous', duration: 30 }
          ]
        },
        now
      )
    ).toBe(
      '2026-11-28T10:00:00.000Z renderer frame 1234 ms · view agents · after click "Close index.ts" 16 ms before · scripts: DOMWindow.onclick fit @ index.js:120 900 ms; TimerHandler:setTimeout anonymous 30 ms'
    )
  })

  it('keeps a line of plain text from whatever the page sends, and refuses a malformed report', () => {
    const line = slowTaskLine(
      {
        duration: 300,
        view: 'files\nforged\u2028line\u009b2J',
        action: null,
        scripts: [{ invoker: 'x'.repeat(1000), source: 's', duration: 1 }, 'junk', { invoker: 1 }]
      },
      now
    )
    expect(line).not.toContain('\n')
    expect(line).toContain('view files forged line 2J · no action yet · scripts: xxx')
    expect(line).not.toMatch(/[\u2028\u009b]/u)
    expect(line?.length).toBeLessThan(500)
    for (const malformed of [
      null,
      { duration: -1, view: 'files', action: null },
      { duration: 300, view: 3, action: null },
      { duration: 300, view: 'files', action: { label: 'click' } },
      { duration: 300, view: 'files' }
    ])
      expect(slowTaskLine(malformed, now)).toBeNull()
  })
})

it('names the requests a main stall left pending, and a handler that blocked main itself', () => {
  expect(stallLine(812.3, [{ channel: 'agent:recent', age: 900.2 }], now)).toBe(
    '2026-11-28T10:00:00.000Z main stall 812 ms · pending agent:recent (started 900 ms before)'
  )
  expect(stallLine(250, [], now)).toBe(
    '2026-11-28T10:00:00.000Z main stall 250 ms · no IPC request pending'
  )
  expect(slowHandlerLine('file-tree:list', 640.7, now)).toBe(
    '2026-11-28T10:00:00.000Z main handler file-tree:list ran 641 ms without yielding'
  )
})

it('counts a tick late by 200 ms or more past its 100 ms interval as a stall', () => {
  expect(stallBetween(1000, 1100)).toBeNull()
  expect(stallBetween(1000, 1299)).toBeNull()
  expect(stallBetween(1000, 1300)).toBe(200)
  expect(stallBetween(1000, 2000)).toBe(900)
})

it('writes at most 500 lines a run, then says the rest were dropped', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'performance-log-'))
  try {
    const file = openLogFile(join(folder, 'logs', 'performance.log'))
    const log = new PerformanceLog(() => file)
    for (let line = 1; line <= 510; line++) log.write(`line ${line}`)
    await file.flushed()
    const lines = (await readFile(file.path, 'utf8')).trimEnd().split('\n')
    expect(lines).toHaveLength(501)
    expect(lines.at(-2)).toBe('line 500')
    expect(lines.at(-1)).toBe('Further entries dropped for this run.')
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
