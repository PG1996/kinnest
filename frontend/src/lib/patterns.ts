import { isOnDay, type TimelineItem } from './timeline'

const BLOCKS = 12 // two hours each
const MIN = 60_000

export type PatternKind = 'feeds' | 'sleep'

const blockStart = (day: Date, b: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), b * 2).getTime()

/** Feeds per day and 2-hour block (rows follow `days`, columns are 00-02, 02-04, ... 22-24 local time). */
export function feedGrid(items: TimelineItem[], days: Date[]): number[][] {
  const grid = days.map(() => Array<number>(BLOCKS).fill(0))
  for (const it of items) {
    if (it.kind !== 'feed') continue
    const at = new Date(it.at)
    const row = days.findIndex((d) => isOnDay(it.at, d))
    if (row >= 0) grid[row]![Math.floor(at.getHours() / 2)]!++
  }
  return grid
}

type Session = { start: number; end: number }

/** Sleep sessions as [start, end] in ms; one still open counts up to `now`. */
function sessions(items: TimelineItem[], now: Date): Session[] {
  return items
    .filter((i) => i.kind === 'sleep')
    .map((i) => {
      const d = i.data as { started_at?: string; ended_at?: string | null }
      const start = Date.parse(d.started_at ?? i.at)
      const end = d.ended_at ? Date.parse(d.ended_at) : now.getTime()
      return { start, end: Math.max(start, end) }
    })
}

/** Minutes asleep per day and 2-hour block; a sleep that crosses a block or midnight is split. */
export function sleepGrid(items: TimelineItem[], days: Date[], now: Date): number[][] {
  const all = sessions(items, now)
  return days.map((day) =>
    Array.from({ length: BLOCKS }, (_, b) => {
      const from = blockStart(day, b)
      const to = blockStart(day, b + 1)
      let ms = 0
      for (const s of all) ms += Math.max(0, Math.min(s.end, to) - Math.max(s.start, from))
      return Math.round(ms / MIN)
    }),
  )
}

export type DailyStats = {
  feedsPerDay: number
  sleepMinutesPerDay: number
  diapersPerDay: number
  /** days (of those given) with at least one feed, sleep or diaper; averages divide by this */
  daysWithData: number
  series: { feeds: number[]; sleep: number[]; diapers: number[] }
  longestSleep: { minutes: number; start: Date; end: Date } | null
}

export function dailyStats(items: TimelineItem[], days: Date[], now: Date): DailyStats {
  const feeds = feedGrid(items, days).map((r) => r.reduce((a, b) => a + b, 0))
  const sleep = sleepGrid(items, days, now).map((r) => r.reduce((a, b) => a + b, 0))
  const diapers = days.map((d) => items.filter((i) => i.kind === 'diaper' && isOnDay(i.at, d)).length)
  const withData = days.filter((_, i) => feeds[i]! + sleep[i]! + diapers[i]! > 0).length
  const avg = (xs: number[]) => (withData === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / withData)
  let longest: DailyStats['longestSleep'] = null
  for (const s of sessions(items, now)) {
    const minutes = Math.round((s.end - s.start) / MIN)
    if (!longest || minutes > longest.minutes) longest = { minutes, start: new Date(s.start), end: new Date(s.end) }
  }
  return {
    feedsPerDay: avg(feeds),
    sleepMinutesPerDay: avg(sleep),
    diapersPerDay: avg(diapers),
    daysWithData: withData,
    series: { feeds, sleep, diapers },
    longestSleep: longest,
  }
}

/** Colour step 0..4 for a heatmap cell: feeds count 0, 1, 2 or more; sleep rounds minutes to half hours, at most 4. */
export function level(value: number, kind: PatternKind): number {
  if (kind === 'feeds') return Math.min(2, value)
  return Math.min(4, Math.round(value / 30))
}
