export type SleepSegment = { start: Date; end: Date; kind: 'sleep' | 'awake' | 'future' }
export type SleepDay = { segments: SleepSegment[]; sleepMin: number; awakeMin: number; futureMin: number }

const minutes = (ms: number) => Math.round(ms / 60_000)

/**
 * One local day, midnight to midnight, cut into asleep, awake and (for today) still-to-come pieces. Sleeps that
 * cross midnight count only their part inside the day; a sleep still going counts up to `now`; overlapping or
 * touching sleeps are merged so nothing is counted twice.
 */
export function sleepDay(sessions: { started_at: string; ended_at: string | null }[], day: Date, now: Date): SleepDay {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
  const limit = Math.max(dayStart, Math.min(dayEnd, now.getTime()))
  const spans = sessions
    .map((s) => [Math.max(dayStart, Date.parse(s.started_at)), Math.min(limit, s.ended_at ? Date.parse(s.ended_at) : now.getTime())] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  const merged: [number, number][] = []
  for (const [a, b] of spans) {
    const last = merged.at(-1)
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else merged.push([a, b])
  }
  const segments: SleepSegment[] = []
  let cursor = dayStart
  for (const [a, b] of merged) {
    if (a > cursor) segments.push({ start: new Date(cursor), end: new Date(a), kind: 'awake' })
    segments.push({ start: new Date(a), end: new Date(b), kind: 'sleep' })
    cursor = b
  }
  if (limit > cursor) segments.push({ start: new Date(cursor), end: new Date(limit), kind: 'awake' })
  if (dayEnd > limit) segments.push({ start: new Date(limit), end: new Date(dayEnd), kind: 'future' })
  const total = (kind: SleepSegment['kind']) => segments.filter((s) => s.kind === kind).reduce((n, s) => n + minutes(s.end.getTime() - s.start.getTime()), 0)
  return { segments, sleepMin: total('sleep'), awakeMin: total('awake'), futureMin: total('future') }
}
