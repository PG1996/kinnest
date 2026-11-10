import type { Diaper, DiaperKind } from '../api/hooks'

const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const isWet = (k: DiaperKind) => k === 'wet' || k === 'both'
const isDirty = (k: DiaperKind) => k === 'dirty' || k === 'both'

export type DiaperStats = {
  /** wet and both */
  wet: number
  /** dirty and both */
  dirty: number
  /** the daily average of the six days before, over the days that had any diapers; null with no earlier data */
  usualWet: number | null
  usualDirty: number | null
  lastWetAt: number | null
  /** the longest time between two diapers; today it includes the wait since the last one */
  longestGapMin: number | null
}

/** Today (or the chosen day) in numbers, against the usual. `diapers` holds the seven days ending on `day`. */
export function diaperStats(diapers: Diaper[], day: Date, nowMs: number): DiaperStats {
  const start = startOf(day).getTime()
  const end = addDays(startOf(day), 1).getTime()
  const sorted = [...diapers].map((x) => ({ ...x, ms: Date.parse(x.at) })).sort((a, b) => a.ms - b.ms)
  const today = sorted.filter((x) => x.ms >= start && x.ms < end)
  const before = sorted.filter((x) => x.ms < start)

  const usual = (pick: (k: DiaperKind) => boolean) => {
    const days = new Map<number, number>()
    for (const x of before) {
      const k = startOf(new Date(x.ms)).getTime()
      days.set(k, (days.get(k) ?? 0) + (pick(x.kind) ? 1 : 0))
    }
    return days.size === 0 ? null : Math.round([...days.values()].reduce((a, b) => a + b, 0) / days.size)
  }

  const gaps: number[] = []
  let prev = before.at(-1)?.ms ?? null
  for (const x of today) {
    if (prev !== null) gaps.push(x.ms - prev)
    prev = x.ms
  }
  const isToday = nowMs >= start && nowMs < end
  if (isToday && prev !== null) gaps.push(nowMs - prev)
  const wetAt = today.filter((x) => isWet(x.kind)).at(-1)?.ms ?? null

  return {
    wet: today.filter((x) => isWet(x.kind)).length,
    dirty: today.filter((x) => isDirty(x.kind)).length,
    usualWet: usual(isWet),
    usualDirty: usual(isDirty),
    lastWetAt: wetAt,
    longestGapMin: gaps.length > 0 ? Math.round(Math.max(...gaps) / 60_000) : null,
  }
}

export type StripDot = { id: string; kind: DiaperKind; minute: number }
export type DayStrip = { day: Date; dots: StripDot[]; wet: number; dirty: number }

/** One strip per local day for the seven days ending on `day`, oldest first: each diaper at its minute of the day. */
export function diaperStrips(diapers: Diaper[], day: Date): DayStrip[] {
  const days = Array.from({ length: 7 }, (_, i) => addDays(startOf(day), i - 6))
  const out: DayStrip[] = days.map((d) => ({ day: d, dots: [], wet: 0, dirty: 0 }))
  for (const x of [...diapers].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const at = new Date(x.at)
    const i = days.findIndex((d) => d.getTime() === startOf(at).getTime())
    if (i < 0) continue
    out[i]!.dots.push({ id: x.id, kind: x.kind, minute: at.getHours() * 60 + at.getMinutes() })
    if (isWet(x.kind)) out[i]!.wet++
    if (isDirty(x.kind)) out[i]!.dirty++
  }
  return out
}
