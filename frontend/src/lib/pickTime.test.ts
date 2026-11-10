import { describe, expect, test } from 'vitest'
import { fromInput, toInput, withTime } from './pickTime'

const now = new Date(2026, 10, 11, 1, 20) // 1:20 AM on 11 Nov

describe('withTime, for something that already happened', () => {
  test('keeps a time earlier today on today', () => {
    expect(withTime(new Date(2026, 10, 11), 0, 45, 'past', now)).toEqual({ at: new Date(2026, 10, 11, 0, 45), moved: null })
  })
  test('a time later than now on today means last night', () => {
    expect(withTime(new Date(2026, 10, 11), 23, 30, 'past', now)).toEqual({ at: new Date(2026, 10, 10, 23, 30), moved: 'yesterday' })
  })
  test('the minute that is now is fine', () => {
    expect(withTime(new Date(2026, 10, 11), 1, 20, 'past', now).moved).toBeNull()
  })
  test('an earlier day keeps any time', () => {
    expect(withTime(new Date(2026, 10, 9), 23, 30, 'past', now)).toEqual({ at: new Date(2026, 10, 9, 23, 30), moved: null })
  })
  test('a later day is pulled back to now', () => {
    expect(withTime(new Date(2026, 10, 12), 9, 0, 'past', now)).toEqual({ at: new Date(2026, 10, 11, 1, 20), moved: 'now' })
  })
})

describe('withTime, for something planned', () => {
  test('keeps a future time as it is', () => {
    expect(withTime(new Date(2026, 10, 12), 9, 0, 'planned', now)).toEqual({ at: new Date(2026, 10, 12, 9, 0), moved: null })
    expect(withTime(new Date(2026, 10, 11), 23, 30, 'planned', now).at).toEqual(new Date(2026, 10, 11, 23, 30))
  })
})

describe('the input format the forms keep', () => {
  test('round-trips local date and time', () => {
    expect(toInput(new Date(2026, 0, 5, 7, 3))).toBe('2026-01-05T07:03')
    expect(fromInput('2026-01-05T07:03')).toEqual(new Date(2026, 0, 5, 7, 3))
  })
  test('an empty or broken value is no time', () => {
    expect(fromInput('')).toBeNull()
    expect(fromInput('nonsense')).toBeNull()
  })
})
