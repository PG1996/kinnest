import { toLocalDate } from './time'

/**
 * The date rules behind the history calendars on the Vitals, Vaccines and Visits tabs, kept apart from drawing so they
 * can be tested. Days are local "YYYY-MM-DD" strings and months are "YYYY-MM", so they sort and compare as text.
 */

export type Month = string

const pad = (n: number) => String(n).padStart(2, '0')
const split = (m: Month) => m.split('-').map(Number) as [number, number]

export const monthOf = (day: string): Month => day.slice(0, 7)
/** The local day of an ISO time, e.g. a reading taken at 11:30 PM stays on that day. */
export const dayOfIso = (iso: string) => toLocalDate(new Date(iso))

export function addMonths(m: Month, n: number): Month {
  const [y, mo] = split(m)
  const d = new Date(y, mo - 1 + n, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export const addYears = (m: Month, n: number): Month => addMonths(m, n * 12)

/** The cells of a month, weeks starting on Sunday: `null` for the blanks before the 1st, then each day. */
export function monthCells(m: Month): (string | null)[] {
  const [y, mo] = split(m)
  const lead = new Date(y, mo - 1, 1).getDay()
  const days = new Date(y, mo, 0).getDate()
  return [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${m}-${pad(i + 1)}`)]
}

/** The twelve months of the year a month is in. */
export const yearMonths = (m: Month): Month[] => Array.from({ length: 12 }, (_, i) => `${m.slice(0, 4)}-${pad(i + 1)}`)

export function groupByDay<T>(items: T[], dayOf: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const x of items) {
    const k = dayOf(x)
    const list = out.get(k)
    if (list) list.push(x)
    else out.set(k, [x])
  }
  return out
}

/** The nearest days with entries before and after a month, for jumping over empty months. */
export function neighbours(days: Iterable<string>, m: Month): { before?: string; after?: string } {
  let before: string | undefined
  let after: string | undefined
  for (const d of days) {
    const dm = monthOf(d)
    if (dm < m && (!before || d > before)) before = d
    if (dm > m && (!after || d < after)) after = d
  }
  return { before, after }
}

/** The months the calendar can show: from the month of birth (or the first entry, if earlier) to this month (or the last entry, if later). */
export function monthRange(days: Iterable<string>, today: string, birth?: string | null): { min: Month; max: Month } {
  const now = monthOf(today)
  let min = birth ? monthOf(birth) : now
  let max = now
  for (const d of days) {
    const dm = monthOf(d)
    if (dm < min) min = dm
    if (dm > max) max = dm
  }
  if (min > now) min = now
  return { min, max }
}

/** A day at the current clock time, for a form opened from that day on the calendar. */
export function atDay(day: string, now = new Date()): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, now.getHours(), now.getMinutes())
}

export type MarkKind = 'given' | 'due' | 'overdue' | 'skipped' | 'done' | 'upcoming' | 'cancelled'

/** The year view colour for a status. */
export const MARK_COLOR: Record<MarkKind, string> = {
  given: 'var(--diaper)',
  due: 'var(--primary)',
  overdue: 'var(--warn-solid)',
  skipped: 'var(--muted)',
  done: 'var(--sleep)',
  upcoming: 'var(--sleep)',
  cancelled: 'var(--muted)',
}
