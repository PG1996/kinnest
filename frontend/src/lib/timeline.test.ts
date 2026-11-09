import { expect, test } from 'vitest'
import { dayRange, lastDays } from './timeline'

test('dayRange runs from local midnight to the last millisecond of the day', () => {
  const { from, to } = dayRange(new Date(2026, 10, 8, 15, 30))
  expect(from.getTime()).toBe(new Date(2026, 10, 8, 0, 0, 0, 0).getTime())
  expect(to.getTime()).toBe(new Date(2026, 10, 8, 23, 59, 59, 999).getTime())
})

test('lastDays returns n local midnights, oldest first, ending today', () => {
  const days = lastDays(7, new Date(2026, 10, 8, 3, 0))
  expect(days).toHaveLength(7)
  expect(days[0]).toEqual(new Date(2026, 10, 2))
  expect(days[6]).toEqual(new Date(2026, 10, 8))
})

test('lastDays crosses a month boundary', () => {
  const days = lastDays(3, new Date(2026, 11, 1, 12))
  expect(days.map((d) => d.getDate())).toEqual([29, 30, 1])
})

import { wetPerDay, type TimelineItem } from './timeline'

const diaper = (at: Date, kind: string): TimelineItem => ({ kind: 'diaper', id: `${at.getTime()}-${kind}`, at: at.toISOString(), data: { kind } })

test('wetPerDay counts wet and both diapers per local day, not dirty ones', () => {
  const days = lastDays(3, new Date(2026, 10, 8, 12))
  const items = [
    diaper(new Date(2026, 10, 8, 9), 'wet'),
    diaper(new Date(2026, 10, 8, 23, 59), 'both'),
    diaper(new Date(2026, 10, 8, 10), 'dirty'),
    diaper(new Date(2026, 10, 7, 0, 0), 'wet'),
    diaper(new Date(2026, 10, 6, 7), 'wet'), // first day of the window
    diaper(new Date(2026, 10, 5, 12), 'wet'), // outside the window
  ]
  expect(wetPerDay(items, days)).toEqual([1, 1, 2])
})
