import { expect, test } from 'vitest'
import i18n from '../i18n'
import { dayRange, describe, lastDays } from './timeline'

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

import { diapersPerDay, type TimelineItem } from './timeline'

const diaper = (at: Date, kind: string): TimelineItem => ({ kind: 'diaper', id: `${at.getTime()}-${kind}`, at: at.toISOString(), data: { kind } })

test('diapersPerDay: a both raises the wet and the dirty line but counts once in the total', () => {
  const days = lastDays(3, new Date(2026, 10, 8, 12))
  const items = [
    diaper(new Date(2026, 10, 8, 9), 'wet'),
    diaper(new Date(2026, 10, 8, 23, 59), 'both'),
    diaper(new Date(2026, 10, 8, 10), 'dirty'),
    diaper(new Date(2026, 10, 8, 11), 'both'),
    diaper(new Date(2026, 10, 7, 0, 0), 'wet'),
    diaper(new Date(2026, 10, 6, 7), 'dirty'), // first day of the window
    diaper(new Date(2026, 10, 5, 12), 'wet'), // outside the window
    { kind: 'feed', id: 'f', at: new Date(2026, 10, 8, 9).toISOString(), data: { type: 'formula' } } as TimelineItem,
  ]
  expect(diapersPerDay(items, days)).toEqual({ wet: [0, 1, 3], dirty: [1, 0, 3], total: [1, 1, 4] })
})

import { fromQueue, isOnDay } from './timeline'

test('isOnDay: 23:59 belongs to that day and 00:00 to the next', () => {
  const day = new Date(2026, 10, 8)
  expect(isOnDay(new Date(2026, 10, 8, 23, 59, 59, 999).toISOString(), day)).toBe(true)
  expect(isOnDay(new Date(2026, 10, 9, 0, 0, 0, 0).toISOString(), day)).toBe(false)
  expect(isOnDay(new Date(2026, 10, 8, 0, 0, 0, 0).toISOString(), day)).toBe(true)
  expect(isOnDay(new Date(2026, 10, 7, 23, 59, 59, 999).toISOString(), day)).toBe(false)
})

test('fromQueue turns waiting entries for that day into pending timeline items', () => {
  const day = new Date(2026, 10, 8)
  const at = new Date(2026, 10, 8, 9).toISOString()
  const q = (kind: string, id: string, payload: object) => ({ kind, id, payload, queuedAt: 1, seq: 1 }) as never
  const items = fromQueue(
    [
      q('feed', 'f1', { id: 'f1', type: 'formula', started_at: at, quantity_ml: 60 }),
      q('diaper', 'd1', { id: 'd1', kind: 'wet', at }),
      q('sleep_start', 's1', { id: 's1', started_at: at }),
      q('vital', 'v1', { id: 'v1', measured_at: at, place_kind: 'home', weight_kg: 3.4 }),
      q('feed', 'f2', { id: 'f2', type: 'formula', started_at: new Date(2026, 10, 7, 9).toISOString() }),
      q('dose', 'x', {}),
      q('sleep_end', 'e', {}),
    ],
    day,
    'Mom',
  )
  expect(items.map((i) => [i.kind, i.id, i.pending])).toEqual([
    ['feed', 'f1', true],
    ['diaper', 'd1', true],
    ['sleep', 's1', true],
    ['vital', 'v1', true],
  ])
  expect(items[0]!.data).toMatchObject({ fed_by_name: 'Mom', quantity_ml: 60 })
})

test('a feed with breaks says so in its details, one without says nothing about breaks', () => {
  const t = i18n.t.bind(i18n)
  const item = (data: object) => ({ kind: 'feed', id: 'f', at: new Date().toISOString(), data: { type: 'breast_left', duration_min: 35, fed_by_name: 'Mom', ...data } }) as never
  expect(describe(item({ break_min: 15 }), t).meta).toBe('by Mom · 15 min of breaks')
  expect(describe(item({ break_min: 0 }), t).meta).toBe('by Mom')
  expect(describe(item({}), t).meta).toBe('by Mom')
})
