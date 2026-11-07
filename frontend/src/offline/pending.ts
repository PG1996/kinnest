import { useEffect, useState } from 'react'
import type { DiaperKind, FeedType, Sleep, Summary } from '../api/hooks'
import { list, listRejected, subscribe, type QueueEntry, type Rejected } from './queue'

const DEFAULT_INTERVAL_MS = 180 * 60_000

/** Show entries still waiting to sync as if saved, so the next caregiver sees them. */
export function mergePending(summary: Summary, pending: QueueEntry[], myName: string): Summary {
  if (pending.length === 0) return summary
  const out: Summary = { ...summary, diapers_today: { ...summary.diapers_today } }
  const feeds = pending.filter((p) => p.kind === 'feed')
  const diapers = pending.filter((p) => p.kind === 'diaper')

  const newestFeed = feeds.sort(
    (a, b) => Date.parse(String(b.payload.started_at)) - Date.parse(String(a.payload.started_at)),
  )[0]
  if (newestFeed) {
    const startedAt = String(newestFeed.payload.started_at)
    const last = summary.last_feed
    out.feeds_today += feeds.length
    if (!last || Date.parse(startedAt) > Date.parse(last.started_at)) {
      const interval =
        last && summary.next_feed_due_at
          ? Date.parse(summary.next_feed_due_at) - Date.parse(last.started_at)
          : DEFAULT_INTERVAL_MS
      out.last_feed = {
        id: newestFeed.id,
        type: newestFeed.payload.type as FeedType,
        started_at: startedAt,
        duration_min: (newestFeed.payload.duration_min as number | undefined) ?? null,
        quantity_ml: (newestFeed.payload.quantity_ml as number | undefined) ?? null,
        note: '',
        fed_by_name: myName,
      }
      out.next_feed_due_at = new Date(Date.parse(startedAt) + interval).toISOString()
    }
  }

  const newestDiaper = diapers.sort((a, b) => Date.parse(String(b.payload.at)) - Date.parse(String(a.payload.at)))[0]
  if (newestDiaper) {
    for (const d of diapers) out.diapers_today[d.payload.kind as DiaperKind]++
    const at = String(newestDiaper.payload.at)
    if (!summary.last_diaper || Date.parse(at) > Date.parse(summary.last_diaper.at)) {
      out.last_diaper = {
        id: newestDiaper.id,
        kind: newestDiaper.payload.kind as DiaperKind,
        at,
        changed_by_name: myName,
      }
    }
  }

  mergePendingSleep(out, summary, pending, myName)
  return out
}

function mergePendingSleep(out: Summary, summary: Summary, pending: QueueEntry[], myName: string): void {
  const starts = pending.filter((p) => p.kind === 'sleep_start')
  const ends = pending.filter((p) => p.kind === 'sleep_end')
  if (!starts.length && !ends.length) return
  const sleep = { open: summary.sleep?.open ?? null, last: summary.sleep?.last ?? null }
  const close = (s: Sleep, endedAt: string): Sleep => ({
    ...s,
    ended_at: endedAt,
    ended_by_name: myName,
    duration_min: Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(s.started_at)) / 60_000)),
  })
  if (!sleep.open) {
    const newest = starts.sort((a, b) => Date.parse(String(b.payload.started_at)) - Date.parse(String(a.payload.started_at)))[0]
    if (newest) {
      sleep.open = {
        id: String(newest.payload.id),
        started_at: String(newest.payload.started_at),
        ended_at: null,
        started_by_name: myName,
        ended_by_name: null,
        duration_min: null,
        note: '',
      }
    }
  }
  const end = sleep.open && ends.find((e) => e.payload.id === sleep.open!.id)
  if (sleep.open && end) {
    sleep.last = close(sleep.open, String(end.payload.ended_at))
    sleep.open = null
  }
  out.sleep = sleep
}

/** Live view of the offline queue: entries waiting to sync and entries the server refused. */
export function useQueue(): { pending: QueueEntry[]; rejected: Rejected[] } {
  const [state, setState] = useState<{ pending: QueueEntry[]; rejected: Rejected[] }>({ pending: [], rejected: [] })
  useEffect(() => {
    let alive = true
    const load = async () => {
      const [pending, rejected] = await Promise.all([list(), listRejected()])
      if (alive) setState({ pending, rejected })
    }
    load()
    const off = subscribe(load)
    return () => {
      alive = false
      off()
    }
  }, [])
  return state
}

/** Key that identifies a medicine slot, so queued doses can be matched to the slots listed by the server. */
export const slotKey = (medicineId: string, scheduledFor: string) => `${medicineId}|${Date.parse(scheduledFor)}`

/** Slots that have a dose waiting to sync. */
export function queuedDoseSlots(pending: QueueEntry[]): Set<string> {
  return new Set(
    pending
      .filter((p) => p.kind === 'dose' && p.payload.scheduled_for)
      .map((p) => slotKey(String(p.payload.medicine_id), String(p.payload.scheduled_for))),
  )
}

/** As-needed doses waiting to sync for one medicine. */
export const queuedAsNeeded = (pending: QueueEntry[], medicineId: string) =>
  pending.filter((p) => p.kind === 'dose' && p.payload.medicine_id === medicineId && !p.payload.scheduled_for).length
