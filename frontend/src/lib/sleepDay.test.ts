import { expect, test } from 'vitest'
import { sleepDay } from './sleepDay'

const D = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m)
const s = (a: Date, b: Date | null) => ({ started_at: a.toISOString(), ended_at: b ? b.toISOString() : null })

test('a sleep that started last night counts only from midnight on this day', () => {
  const r = sleepDay([s(D(8, 22), D(9, 2))], D(9), D(10, 12))
  expect(r.sleepMin).toBe(120)
  expect(r.segments[0]).toMatchObject({ kind: 'sleep' })
  expect(r.segments[0]!.start.getTime()).toBe(D(9).getTime())
})

test('on a finished day sleep and awake add up to 24 hours', () => {
  const r = sleepDay([s(D(9, 1), D(9, 4)), s(D(9, 13), D(9, 14, 30))], D(9), D(10, 12))
  expect(r.sleepMin).toBe(270)
  expect(r.awakeMin).toBe(1440 - 270)
  expect(r.futureMin).toBe(0)
  expect(r.segments.map((x) => x.kind)).toEqual(['awake', 'sleep', 'awake', 'sleep', 'awake'])
})

test('today, the time still to come is neither sleep nor awake', () => {
  const r = sleepDay([s(D(9, 1), D(9, 3))], D(9), D(9, 12))
  expect(r.sleepMin).toBe(120)
  expect(r.awakeMin).toBe(720 - 120)
  expect(r.futureMin).toBe(720)
  expect(r.segments.at(-1)).toMatchObject({ kind: 'future' })
})

test('a sleep still going counts up to now', () => {
  const r = sleepDay([s(D(9, 10), null)], D(9), D(9, 11, 30))
  expect(r.sleepMin).toBe(90)
})

test('overlapping or touching sleeps are not counted twice', () => {
  const r = sleepDay([s(D(9, 1), D(9, 3)), s(D(9, 2), D(9, 4)), s(D(9, 4), D(9, 5))], D(9), D(10))
  expect(r.sleepMin).toBe(240)
  expect(r.segments.filter((x) => x.kind === 'sleep')).toHaveLength(1)
})

test('a day with no sleep logged is all awake, never NaN', () => {
  const r = sleepDay([], D(9), D(10))
  expect(r).toMatchObject({ sleepMin: 0, awakeMin: 1440, futureMin: 0 })
})
