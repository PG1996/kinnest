import type { DoseRow } from '../api/hooks'

export type DoseGroup = {
  /** the time the dose was for: its slot, or the moment it was given when it has no slot */
  at: string
  /** the dose belongs to a schedule slot (pieces of one slot share a group) */
  slot: boolean
  /** newest piece first */
  rows: DoseRow[]
  /** the amounts given, added up */
  total: number
  allSkipped: boolean
}
export type DoseDay = { day: string; at: string; groups: DoseGroup[] }

const dayKey = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

/** Doses grouped for the history: by day, then by the time each dose was for. Newest first. */
export function groupDoses(rows: DoseRow[]): DoseDay[] {
  const groups = new Map<string, DoseGroup>()
  for (const r of rows) {
    const key = r.scheduled_for ? `slot:${Date.parse(r.scheduled_for)}` : `own:${r.id}`
    const g = groups.get(key) ?? { at: r.scheduled_for ?? r.given_at, slot: !!r.scheduled_for, rows: [], total: 0, allSkipped: true }
    g.rows.push(r)
    if (r.status === 'given') {
      g.allSkipped = false
      g.total += r.amount ?? 0
    }
    groups.set(key, g)
  }
  const days = new Map<string, DoseDay>()
  for (const g of [...groups.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))) {
    g.rows.sort((a, b) => Date.parse(b.given_at) - Date.parse(a.given_at))
    g.total = Math.round(g.total * 100) / 100
    const key = dayKey(g.at)
    const day = days.get(key) ?? { day: key, at: g.at, groups: [] }
    day.groups.push(g)
    days.set(key, day)
  }
  return [...days.values()]
}
