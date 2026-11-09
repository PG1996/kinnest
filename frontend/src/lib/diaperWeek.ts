import type { Diaper } from '../api/hooks'

export type DiaperDayCount = { day: Date; wet: number; dirty: number; both: number }

/** Counts by kind for the seven local days ending on `day`, oldest first. */
export function diaperWeek(diapers: Diaper[], day: Date): DiaperDayCount[] {
  const days = Array.from({ length: 7 }, (_, i) => new Date(day.getFullYear(), day.getMonth(), day.getDate() - (6 - i)))
  const out = days.map((d) => ({ day: d, wet: 0, dirty: 0, both: 0 }))
  for (const d of diapers) {
    const at = new Date(d.at)
    const i = days.findIndex((x) => x.getFullYear() === at.getFullYear() && x.getMonth() === at.getMonth() && x.getDate() === at.getDate())
    if (i >= 0) out[i]![d.kind]++
  }
  return out
}
