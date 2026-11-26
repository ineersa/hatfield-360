import { describe, expect, it } from 'vitest'
import { DoubleShiftPress } from './double-shift-press'

const shift = (timeStamp: number, repeat = false) => ({ key: 'Shift', repeat, timeStamp })

/** Presses and releases each key at the given times; which presses completed a double Shift. */
function play(steps: [string, number][], detector = new DoubleShiftPress()): number[] {
  const hits: number[] = []
  for (const [key, at] of steps) {
    if (detector.keyDown({ key, repeat: false, timeStamp: at })) hits.push(at)
    detector.keyUp({ key, repeat: false, timeStamp: at + 50 })
  }
  return hits
}

describe('DoubleShiftPress', () => {
  it('fires on the second of two lone Shift presses close together', () => {
    expect(
      play([
        ['Shift', 0],
        ['Shift', 300]
      ])
    ).toEqual([300])
    // A third press starts over rather than firing again.
    expect(
      play([
        ['Shift', 0],
        ['Shift', 300],
        ['Shift', 500]
      ])
    ).toEqual([300])
  })

  it('ignores presses too far apart, with another key between, or after a click', () => {
    expect(
      play([
        ['Shift', 0],
        ['Shift', 1000]
      ])
    ).toEqual([])
    expect(
      play([
        ['Shift', 0],
        ['a', 100],
        ['Shift', 200]
      ])
    ).toEqual([])
    const detector = new DoubleShiftPress()
    play([['Shift', 0]], detector)
    detector.reset()
    expect(play([['Shift', 200]], detector)).toEqual([])
  })

  it('ignores Shift held for a capital letter, and the key repeating while held', () => {
    const detector = new DoubleShiftPress()
    expect(detector.keyDown(shift(0))).toBe(false)
    expect(detector.keyDown({ key: 'R', repeat: false, timeStamp: 10 })).toBe(false)
    detector.keyUp(shift(20))
    expect(detector.keyDown(shift(100))).toBe(false)
    expect(detector.keyDown(shift(150, true))).toBe(false)
  })
})
