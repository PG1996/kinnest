import { expect, test } from 'vitest'
import { addMonths, addYears, atDay, dayOfIso, groupByDay, monthCells, monthRange, neighbours, yearMonths } from './calendar'

test('months move across year ends', () => {
  expect(addMonths('2026-11', 1)).toBe('2026-12')
  expect(addMonths('2026-12', 1)).toBe('2027-01')
  expect(addMonths('2026-01', -1)).toBe('2025-12')
  expect(addYears('2026-06', 1)).toBe('2027-06')
})

test('a month starts after blanks up to its weekday, weeks starting on Sunday', () => {
  const nov = monthCells('2026-11') // 1 Nov 2026 is a Sunday
  expect(nov[0]).toBe('2026-11-01')
  expect(nov).toHaveLength(30)
  const oct = monthCells('2026-10') // 1 Oct 2026 is a Thursday
  expect(oct.slice(0, 5)).toEqual([null, null, null, null, '2026-10-01'])
  expect(oct.at(-1)).toBe('2026-10-31')
  expect(monthCells('2028-02').filter(Boolean)).toHaveLength(29)
})

test('a year has its twelve months', () => {
  expect(yearMonths('2026-07')).toEqual(Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`))
})

test('a time late at night stays on its local day', () => {
  expect(dayOfIso(new Date(2026, 9, 21, 23, 40).toISOString())).toBe('2026-10-21')
  expect(dayOfIso(new Date(2026, 9, 22, 0, 5).toISOString())).toBe('2026-10-22')
})

test('entries are grouped by day, keeping their order', () => {
  const m = groupByDay(
    [
      { d: '2026-10-21', n: 1 },
      { d: '2026-10-22', n: 2 },
      { d: '2026-10-21', n: 3 },
    ],
    (x) => x.d,
  )
  expect([...m.keys()]).toEqual(['2026-10-21', '2026-10-22'])
  expect(m.get('2026-10-21')!.map((x) => x.n)).toEqual([1, 3])
})

test('the nearest entries outside a month are found either side, skipping empty months', () => {
  const days = ['2026-06-04', '2026-08-13', '2026-08-11', '2026-11-20', '2027-03-02', '2026-10-22']
  expect(neighbours(days, '2026-10')).toEqual({ before: '2026-08-13', after: '2026-11-20' })
  expect(neighbours(days, '2026-06')).toEqual({ before: undefined, after: '2026-08-11' })
  expect(neighbours(days, '2027-03')).toEqual({ before: '2026-11-20', after: undefined })
})

test('the calendar runs from the month of birth to this month, or further for entries outside', () => {
  const today = '2026-11-13'
  expect(monthRange(['2026-08-01'], today, '2026-06-02')).toEqual({ min: '2026-06', max: '2026-11' })
  expect(monthRange(['2026-05-30', '2027-03-02'], today, '2026-06-02')).toEqual({ min: '2026-05', max: '2027-03' })
  expect(monthRange([], today, null)).toEqual({ min: '2026-11', max: '2026-11' })
  expect(monthRange([], today, '2027-01-01')).toEqual({ min: '2026-11', max: '2026-11' })
})

test('a form opened from a day gets that day at the current clock time', () => {
  const d = atDay('2026-10-21', new Date(2026, 10, 13, 9, 45))
  expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 21, 9, 45])
})
