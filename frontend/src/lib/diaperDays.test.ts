import type { Diaper } from '../api/hooks'
import { diaperStats, diaperStrips } from './diaperDays'

const at = (h: number, m = 0, daysBack = 0) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBack, h, m) }
const d = (id: string, kind: Diaper['kind'], when: Date) => ({ id, kind, at: when.toISOString(), changed_by_name: 'Mom', note: '' }) as Diaper
const day = at(0)
const NOW = at(15).getTime()

test('a diaper counts as wet if it is wet or both, and as dirty if it is dirty or both', () => {
  const s = diaperStats([d('1', 'wet', at(1)), d('2', 'both', at(2)), d('3', 'dirty', at(3))], day, NOW)
  expect(s.wet).toBe(2)
  expect(s.dirty).toBe(2)
})

test('usual is the average of the days before that had any diapers, rounded', () => {
  const prev = [d('a', 'wet', at(1, 0, 1)), d('b', 'wet', at(2, 0, 1)), d('c', 'wet', at(1, 0, 2)), d('e', 'wet', at(2, 0, 2)), d('f', 'wet', at(3, 0, 2)), d('g', 'dirty', at(4, 0, 2))]
  const s = diaperStats([...prev, d('t', 'wet', at(1))], day, NOW)
  expect(s.usualWet).toBe(3) // (2 + 3) / 2 = 2.5, rounded up
  expect(s.usualDirty).toBe(1) // one dirty over the two days that had diapers
})

test('there is no usual before any earlier day has data', () => {
  const s = diaperStats([d('t', 'wet', at(1))], day, NOW)
  expect(s.usualWet).toBeNull()
  expect(s.usualDirty).toBeNull()
})

test('the last wet diaper is the latest wet or both of the day, and none is null', () => {
  const s = diaperStats([d('1', 'wet', at(1)), d('2', 'dirty', at(5)), d('3', 'both', at(9))], day, NOW)
  expect(s.lastWetAt).toBe(at(9).getTime())
  expect(diaperStats([d('1', 'dirty', at(5))], day, NOW).lastWetAt).toBeNull()
})

test('the longest gap includes the one since the previous night and, today, the one since the last diaper', () => {
  const s = diaperStats([d('0', 'wet', at(22, 0, 1)), d('1', 'wet', at(2)), d('2', 'wet', at(4))], day, NOW)
  // 22:00 -> 02:00 is 4 h, 02:00 -> 04:00 is 2 h, 04:00 -> now (15:00) is 11 h
  expect(s.longestGapMin).toBe(11 * 60)
})

test('on a past day the gap after its last diaper is not counted', () => {
  const past = at(0, 0, 2)
  const s = diaperStats([d('1', 'wet', at(1, 0, 2)), d('2', 'wet', at(4, 0, 2))], past, NOW)
  expect(s.longestGapMin).toBe(3 * 60)
})

test('a single diaper with nothing before it has no gap', () => {
  const past = at(0, 0, 2)
  expect(diaperStats([d('1', 'wet', at(1, 0, 2))], past, NOW).longestGapMin).toBeNull()
})

test('strips are seven days ending on the chosen day, with each diaper at its minute of the day', () => {
  const strips = diaperStrips([d('1', 'wet', at(6, 30)), d('2', 'dirty', at(18, 15, 2))], day)
  expect(strips).toHaveLength(7)
  expect(strips.at(-1)!.dots).toEqual([{ id: '1', kind: 'wet', minute: 6 * 60 + 30 }])
  expect(strips.at(-3)!.dots).toEqual([{ id: '2', kind: 'dirty', minute: 18 * 60 + 15 }])
  expect(strips[0]!.dots).toEqual([])
  expect(strips.at(-1)).toMatchObject({ wet: 1, dirty: 0 })
})
