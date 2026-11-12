import { expect, test } from 'vitest'
import { laneOf, lanesFor, markRange, overlaps, packMoments, PRESETS, tickStep, toMarks, totals, zoomTo } from './dayChart'
import type { TimelineItem } from './timeline'

const DAY = new Date(2026, 10, 10)
const at = (h: number, m = 0, d = 10) => new Date(2026, 10, d, h, m).toISOString()
const LATE = new Date(2026, 10, 11, 12).getTime() // a "now" well after the day
const min = (h: number, m = 0) => h * 60 + m

const sleep = (id: string, from: string, to: string | null): TimelineItem => ({
  kind: 'sleep', id, at: from, data: { started_at: from, ended_at: to, duration_min: null },
})
const feed = (id: string, when: string, data: object): TimelineItem => ({ kind: 'feed', id, at: when, data: { started_at: when, ...data } })

test('a sleep is a bar from its start to its end, in minutes since midnight', () => {
  const [m] = toMarks([sleep('s', at(9, 10), at(10, 25))], DAY, LATE)
  expect(m).toMatchObject({ lane: 'sleep', bar: true, from: min(9, 10), to: min(10, 25), live: false })
})

test('a sleep from the night before is cut at midnight, and one running past midnight is cut at the end of the day', () => {
  const marks = toMarks([sleep('a', at(21, 40, 9), at(2, 5)), sleep('b', at(21, 15), at(6, 0, 11))], DAY, LATE)
  expect(marks.map((m) => [m.item.id, m.from, m.to])).toEqual([['a', 0, min(2, 5)], ['b', min(21, 15), 1440]])
})

test('entries wholly on another day are left out', () => {
  const marks = toMarks([sleep('old', at(13, 0, 9), at(14, 0, 9)), { kind: 'diaper', id: 'd', at: at(23, 0, 9), data: { kind: 'wet' } }], DAY, LATE)
  expect(marks).toEqual([])
})

test('an ongoing sleep runs to now and is marked live', () => {
  const now = new Date(2026, 10, 10, 15, 40).getTime()
  const [m] = toMarks([sleep('s', at(15, 5), null)], DAY, now)
  expect(m).toMatchObject({ from: min(15, 5), to: min(15, 40), live: true })
})

test("a mom's feed with a length is a bar that includes its breaks; a bottle is a moment", () => {
  const marks = toMarks([feed('b', at(11, 0), { type: 'breast_right', duration_min: 18, break_min: 5 }), feed('f', at(8, 30), { type: 'formula', quantity_ml: 90, duration_min: null })], DAY, LATE)
  expect(marks.find((m) => m.item.id === 'b')).toMatchObject({ bar: true, from: min(11, 0), to: min(11, 23) })
  expect(marks.find((m) => m.item.id === 'f')).toMatchObject({ bar: false, from: min(8, 30), to: min(8, 30) })
})

test("a mom's feed with no length is still a moment", () => {
  const [m] = toMarks([feed('b', at(11, 0), { type: 'breast_left', duration_min: null })], DAY, LATE)
  expect(m.bar).toBe(false)
})

test('a skipped dose is flagged', () => {
  const [m] = toMarks([{ kind: 'dose', id: 'p', at: at(9), data: { status: 'skipped' } }], DAY, LATE)
  expect(m).toMatchObject({ lane: 'dose', skipped: true })
})

test('visits and vaccines share one lane, which only shows on days that have one', () => {
  expect(laneOf('visit')).toBe('health')
  expect(laneOf('vaccine')).toBe('health')
  const plain = toMarks([{ kind: 'diaper', id: 'd', at: at(9), data: { kind: 'wet' } }], DAY, LATE)
  expect(lanesFor(plain)).toEqual(['sleep', 'feed', 'diaper', 'dose', 'vital'])
  const withVisit = toMarks([{ kind: 'visit', id: 'v', at: at(11), data: {} }], DAY, LATE)
  expect(lanesFor(withVisit)).toEqual(['sleep', 'feed', 'diaper', 'dose', 'vital', 'health'])
})

test('a range holds the marks that touch it, and no range holds everything', () => {
  const [m] = toMarks([sleep('s', at(9, 10), at(10, 25))], DAY, LATE)
  expect(overlaps(m, null)).toBe(true)
  expect(overlaps(m, { from: min(10, 25), to: min(11) })).toBe(true)
  expect(overlaps(m, { from: min(10, 26), to: min(11) })).toBe(false)
})

test('tapping a bar picks its span; tapping a moment picks 10 minutes either side, kept inside the day', () => {
  const [bar, early] = toMarks([sleep('s', at(9, 10), at(10, 25)), { kind: 'diaper', id: 'd', at: at(0, 4), data: { kind: 'wet' } }], DAY, LATE)
  expect(markRange(bar)).toEqual({ from: min(9, 10), to: min(10, 25) })
  expect(markRange(early)).toEqual({ from: 0, to: 14 })
})

test('moments that would overlap go to the next free row, and past the last row they overflow', () => {
  expect(packMoments([10, 12, 14, 16, 40], 6, 3)).toEqual([0, 1, 2, -1, 0])
  expect(packMoments([10, 30], 6, 3)).toEqual([0, 0])
})

test('totals add up what falls in the range', () => {
  const marks = toMarks(
    [
      sleep('s1', at(21, 40, 9), at(2, 5)),
      sleep('s2', at(13, 0), at(14, 50)),
      feed('b', at(11, 0), { type: 'breast_right', duration_min: 18, break_min: 0 }),
      feed('f', at(8, 30), { type: 'formula', quantity_ml: 90 }),
      feed('e', at(14, 55), { type: 'expressed', quantity_ml: 120 }),
      { kind: 'diaper', id: 'd1', at: at(8, 30), data: { kind: 'dirty' } },
      { kind: 'diaper', id: 'd2', at: at(14, 52), data: { kind: 'wet' } },
      { kind: 'diaper', id: 'd3', at: at(10, 27), data: { kind: 'both' } },
      { kind: 'dose', id: 'p1', at: at(9), data: { status: 'given' } },
      { kind: 'dose', id: 'p2', at: at(13, 30), data: { status: 'skipped' } },
      { kind: 'vital', id: 'v1', at: at(14, 58), data: {} },
      { kind: 'visit', id: 'vi', at: at(11, 30), data: {} },
      { kind: 'vaccine', id: 'va', at: at(9), data: {} },
    ],
    DAY,
    LATE,
  )
  const all = totals(marks, null)
  expect(all.sleep.minutes).toBe(min(2, 5) + 110)
  expect(all.feed).toEqual({ count: 3, ml: 210, breastMin: 18 })
  expect(all.diaper).toEqual({ count: 3, wet: 1, dirty: 1, both: 1 })
  expect(all.dose).toEqual({ given: 1, skipped: 1 })
  expect(all.vital.count).toBe(1)
  expect(all.health).toEqual({ visits: 1, vaccines: 1 })
  // 2:00 PM to 3:00 PM: 50 minutes of the nap, the expressed bottle, one diaper, the reading
  const hour = totals(marks, { from: min(14), to: min(15) })
  expect(hour.sleep.minutes).toBe(50)
  expect(hour.feed).toEqual({ count: 1, ml: 120, breastMin: 0 })
  expect(hour.diaper.count).toBe(1)
  expect(hour.vital.count).toBe(1)
  expect(hour.dose).toEqual({ given: 0, skipped: 0 })
})

test('hour lines are as close as the width allows', () => {
  expect(tickStep(1440, 340)).toBe(180)
  expect(tickStep(1440, 900)).toBe(60)
  expect(tickStep(120, 340)).toBe(15)
})

test('zooming pads the range a little and stays inside the day', () => {
  expect(zoomTo({ from: 0, to: 360 })).toEqual({ from: 0, to: 389 })
  expect(zoomTo({ from: 600, to: 610 })).toEqual({ from: 595, to: 615 })
})

test('the quick ranges split the day into four', () => {
  expect(PRESETS.map((p) => [p.id, p.from, p.to])).toEqual([['night', 0, 360], ['morning', 360, 720], ['afternoon', 720, 1080], ['evening', 1080, 1440]])
})
