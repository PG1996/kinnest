import { useEffect, useState } from 'react'
import type { DiaperKind, FeedType, Summary } from '../api/hooks'
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
  return out
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
