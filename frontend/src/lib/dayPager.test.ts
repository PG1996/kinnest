import { describe, expect, test } from 'vitest'
import { dragOffset, lockAxis, stripDays, swipeResult } from './dayPager'

describe('lockAxis', () => {
  test('waits until the finger has moved 10px', () => {
    expect(lockAxis(6, 4)).toBeNull()
  })
  test('locks sideways when the move is mostly sideways', () => {
    expect(lockAxis(-14, 5)).toBe('x')
  })
  test('locks up-and-down when the move is mostly vertical, so the page scrolls', () => {
    expect(lockAxis(8, 20)).toBe('y')
  })
})

describe('swipeResult', () => {
  const width = 360
  test('a drag left past a third of the width turns to the next day', () => {
    expect(swipeResult(-130, 600, width, true)).toBe('next')
  })
  test('a drag right past a third turns to the day before', () => {
    expect(swipeResult(130, 600, width, true)).toBe('prev')
  })
  test('a short slow drag springs back', () => {
    expect(swipeResult(-60, 600, width, true)).toBeNull()
  })
  test('a short quick flick still turns', () => {
    expect(swipeResult(-50, 80, width, true)).toBe('next')
  })
  test('a tiny flick does not', () => {
    expect(swipeResult(-20, 30, width, true)).toBeNull()
  })
  test('there is no day after today', () => {
    expect(swipeResult(-200, 300, width, false)).toBeNull()
    expect(swipeResult(200, 300, width, false)).toBe('prev')
  })
})

describe('dragOffset', () => {
  test('the day follows the finger', () => {
    expect(dragOffset(-80, true)).toBe(-80)
    expect(dragOffset(80, false)).toBe(80)
  })
  test('past today it only gives a little, like a rubber band', () => {
    expect(dragOffset(-80, false)).toBe(-20)
  })
})

describe('stripDays', () => {
  const today = new Date(2026, 10, 11)
  test('21 days ending today while the day is recent', () => {
    const days = stripDays(new Date(2026, 10, 5), today)
    expect(days).toHaveLength(21)
    expect(days.at(-1)).toEqual(today)
    expect(days[0]).toEqual(new Date(2026, 9, 22))
  })
  test('an older day sits near the end of its strip, with a few days after it', () => {
    const day = new Date(2026, 8, 1)
    const days = stripDays(day, today)
    expect(days.at(-1)).toEqual(new Date(2026, 8, 4))
    expect(days.some((d) => d.getTime() === day.getTime())).toBe(true)
  })
})
