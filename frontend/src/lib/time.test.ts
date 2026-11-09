import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { formatClock, formatHour, formatTime } from './time'

const am = (s: string) => s.replace(/\s/g, ' ') // newer ICU puts a narrow no-break space before AM/PM

test('times are 12-hour with AM or PM, on every hour of the day', () => {
  const cases: [number, number, string][] = [
    [0, 5, '12:05 AM'],
    [9, 30, '9:30 AM'],
    [12, 0, '12:00 PM'],
    [13, 0, '1:00 PM'],
    [21, 5, '9:05 PM'],
    [23, 59, '11:59 PM'],
  ]
  for (const [h, m, want] of cases) {
    const d = new Date(2026, 10, 9, h, m)
    expect(am(formatTime(d))).toBe(want)
    expect(am(formatClock(d.toISOString()))).toBe(want)
  }
})

test('formatHour gives a bare hour with AM or PM', () => {
  expect([0, 6, 12, 18].map((h) => am(formatHour(h)))).toEqual(['12 AM', '6 AM', '12 PM', '6 PM'])
})

test('no screen formats a time on its own: they all use lib/time', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n)
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) && !n.includes('.test.') ? [p] : []
    })
  const offenders = walk(join(__dirname, '..')).filter((f) => !f.endsWith(join('lib', 'time.ts')) && /toLocaleTimeString/.test(readFileSync(f, 'utf8')))
  expect(offenders.map((f) => f.replace(join(__dirname, '..') + '/', ''))).toEqual([])
})
