export type TimelineKind = 'feed' | 'diaper' | 'sleep' | 'dose' | 'vital' | 'vaccine' | 'visit'

export type TimelineItem = {
  kind: TimelineKind
  id: string
  at: string
  data: Record<string, unknown>
  /** true for an entry saved on this phone that has not synced yet */
  pending?: boolean
}

/** Local midnight to the last millisecond of the same local day. */
export function dayRange(day: Date): { from: Date; to: Date } {
  return {
    from: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0),
    to: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999),
  }
}

/** `n` local midnights, oldest first, the last one being today. */
export function lastDays(n: number, today = new Date()): Date[] {
  return Array.from({ length: n }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - (n - 1 - i)))
}

/** Wet-or-both diapers per local day, one number for each day in `days`. */
export function wetPerDay(items: TimelineItem[], days: Date[]): number[] {
  const counts = days.map(() => 0)
  for (const it of items) {
    if (it.kind !== 'diaper' || (it.data.kind !== 'wet' && it.data.kind !== 'both')) continue
    const at = new Date(it.at)
    const i = days.findIndex((d) => d.getFullYear() === at.getFullYear() && d.getMonth() === at.getMonth() && d.getDate() === at.getDate())
    if (i >= 0) counts[i]++
  }
  return counts
}
