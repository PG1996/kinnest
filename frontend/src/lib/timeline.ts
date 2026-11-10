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

import type { TFunction } from 'i18next'
import type { Vital } from '../api/hooks'
import type { QueueEntry } from '../offline/queue'
import type { Tone } from '../components/ui/card'
import { formatAgo } from './time'
import { formatPlace, formatValues } from './vitalsFormat'

/** Is this instant on the given local day (midnight to midnight, device timezone)? */
export function isOnDay(iso: string, day: Date): boolean {
  const { from, to } = dayRange(day)
  const t = Date.parse(iso)
  return t >= from.getTime() && t <= to.getTime()
}

/** Entries saved on this phone and not synced yet, as timeline items for one day (feeds, diapers, sleep starts, vitals). */
export function fromQueue(pending: QueueEntry[], day: Date, myName: string): TimelineItem[] {
  const out: TimelineItem[] = []
  for (const e of pending) {
    const p = e.payload
    if (e.kind === 'feed' && isOnDay(String(p.started_at), day))
      out.push({ kind: 'feed', id: e.id, at: String(p.started_at), pending: true, data: { ...p, fed_by_name: myName } })
    else if (e.kind === 'diaper' && isOnDay(String(p.at), day))
      out.push({ kind: 'diaper', id: e.id, at: String(p.at), pending: true, data: { ...p, changed_by_name: myName } })
    else if (e.kind === 'sleep_start' && isOnDay(String(p.started_at), day))
      out.push({ kind: 'sleep', id: e.id, at: String(p.started_at), pending: true, data: { ...p, ended_at: null, started_by_name: myName } })
    else if (e.kind === 'vital' && isOnDay(String(p.measured_at), day))
      out.push({ kind: 'vital', id: e.id, at: String(p.measured_at), pending: true, data: { ...p } })
  }
  return out
}

export type Described = { title: string; meta: string; tone: Tone }

/** The words and colour for one timeline row. */
export function describe(item: TimelineItem, t: TFunction): Described {
  const d = item.data as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const by = (name: unknown) => (name ? t('home.by', { name }) : '')
  switch (item.kind) {
    case 'feed': {
      const amount = d.quantity_ml != null ? ` · ${d.quantity_ml} ml` : d.duration_min != null ? ` · ${d.duration_min} min` : ''
      const breaks = d.break_min > 0 ? t('feed.breakTotal', { n: d.break_min }) : ''
      return { title: `${t(`feedTypes.${d.type}`)}${amount}`, meta: [by(d.fed_by_name), breaks].filter(Boolean).join(' · '), tone: 'feed' }
    }
    case 'diaper':
      return { title: t(`diaperKinds.${d.kind}`), meta: by(d.changed_by_name), tone: 'diaper' }
    case 'sleep':
      return {
        title: d.ended_at && d.duration_min != null ? t('timeline.slept', { duration: formatAgo(d.duration_min * 60_000) }) : t('timeline.asleep'),
        meta: by(d.started_by_name),
        tone: 'sleep',
      }
    case 'dose': {
      const dose = d.amount != null ? `${d.amount} ${d.dose_unit ?? ''}`.trim() : ''
      return {
        title: d.status === 'skipped' ? t('timeline.doseSkipped', { name: d.medicine_name }) : [d.medicine_name, dose].filter(Boolean).join(' · '),
        meta: by(d.by_name),
        tone: 'med',
      }
    }
    case 'vital':
      return { title: formatValues(t, d as Partial<Vital>), meta: formatPlace(t, d.place_kind, d.place_name), tone: 'plain' }
    case 'vaccine':
      return { title: `${d.name} ${d.dose_label ?? ''}`.trim(), meta: d.place ? t('vaccines.at', { place: d.place }) : t('timeline.vaccineGiven'), tone: 'sleep' }
    case 'visit':
      return { title: [d.doctor, d.reason].filter(Boolean).join(' · '), meta: d.place ?? '', tone: 'sleep' }
  }
}
