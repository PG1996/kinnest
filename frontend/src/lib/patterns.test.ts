import { describe, expect, test } from 'vitest'
import { dailyStats, feedGrid, level, sleepGrid } from './patterns'
import { lastDays, type TimelineItem } from './timeline'

const D = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m)
const feed = (at: Date): TimelineItem => ({ kind: 'feed', id: `f${at.getTime()}`, at: at.toISOString(), data: {} })
const diaper = (at: Date): TimelineItem => ({ kind: 'diaper', id: `d${at.getTime()}`, at: at.toISOString(), data: { kind: 'wet' } })
const sleep = (start: Date, end: Date | null): TimelineItem => ({
  kind: 'sleep',
  id: `s${start.getTime()}`,
  at: start.toISOString(),
  data: { started_at: start.toISOString(), ended_at: end ? end.toISOString() : null, duration_min: end ? Math.round((end.getTime() - start.getTime()) / 60000) : null },
})
const days = (n: number, last = 8) => lastDays(n, D(last, 12))

describe('feedGrid', () => {
  test('feeds land in the right 2-hour block', () => {
    const g = feedGrid([feed(D(8, 9, 30)), feed(D(8, 23, 59)), feed(D(8, 0, 0)), feed(D(8, 10, 0))], days(2))
    expect(g[1]![4]).toBe(1) // 08:00 to 10:00 holds 09:30
    expect(g[1]![5]).toBe(1) // 10:00 belongs to the next block
    expect(g[1]![11]).toBe(1)
    expect(g[1]![0]).toBe(1)
    expect(g[0]!.every((v) => v === 0)).toBe(true)
  })
})

describe('sleepGrid', () => {
  test('a sleep across midnight is split between the two days', () => {
    const g = sleepGrid([sleep(D(7, 22, 0), D(8, 2, 0))], days(2), D(8, 12))
    expect(g[0]![11]).toBe(120)
    expect(g[1]![0]).toBe(120)
    expect(g[0]!.slice(0, 11).every((v) => v === 0)).toBe(true)
  })
  test('minutes are split between neighbouring blocks', () => {
    const g = sleepGrid([sleep(D(8, 9, 30), D(8, 10, 15))], days(1), D(8, 12))
    expect([g[0]![4], g[0]![5]]).toEqual([30, 15])
  })
  test('an open sleep counts up to now', () => {
    const g = sleepGrid([sleep(D(8, 9, 0), null)], days(1), D(8, 10, 30))
    expect([g[0]![4], g[0]![5]]).toEqual([60, 30])
  })
})

describe('dailyStats', () => {
  test('longest sleep is found', () => {
    const s = dailyStats([sleep(D(7, 23, 40), D(8, 2, 50)), sleep(D(8, 10, 0), D(8, 11, 0))], days(2), D(8, 12))
    expect(s.longestSleep).toMatchObject({ minutes: 190 })
    expect(s.longestSleep!.start.getTime()).toBe(D(7, 23, 40).getTime())
  })
  test('with two days of data the averages use those two days, not seven', () => {
    const items = [feed(D(7, 8)), feed(D(7, 12)), feed(D(8, 8)), feed(D(8, 10)), feed(D(8, 12)), feed(D(8, 14)), diaper(D(8, 9))]
    const s = dailyStats(items, days(7), D(8, 18))
    expect(s.daysWithData).toBe(2)
    expect(s.feedsPerDay).toBe(3)
    expect(s.series.feeds).toEqual([0, 0, 0, 0, 0, 2, 4])
    expect(s.diapersPerDay).toBe(0.5)
  })
  test('no data at all gives zeros, not NaN', () => {
    const s = dailyStats([], days(7), D(8, 12))
    expect(s).toMatchObject({ feedsPerDay: 0, sleepMinutesPerDay: 0, diapersPerDay: 0, daysWithData: 0, longestSleep: null })
  })
})

test('level maps feeds to 0..2 and sleep minutes to 0..4', () => {
  expect([0, 1, 2, 5].map((v) => level(v, 'feeds'))).toEqual([0, 1, 2, 2])
  expect([0, 14, 30, 59, 60, 90, 120, 200].map((v) => level(v, 'sleep'))).toEqual([0, 0, 1, 2, 2, 3, 4, 4])
})
