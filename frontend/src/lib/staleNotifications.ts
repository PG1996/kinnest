import { useEffect } from 'react'
import type { KidInfo, Medicine, Summary } from '../api/hooks'

type Shown = { data?: { url?: string }; close: () => void }

/** What the app knows right now: a reminder is stale when the thing it asks for has been done. */
type Facts = { summary: Summary | undefined; kid: KidInfo | undefined; medicines: Medicine[]; now: number }

/**
 * Has the entry this reminder asks for been logged since? Same rules as the server's reminders: a feed is due one interval
 * after the last one, a diaper alert comes one alert period after the last change, a medicine reminder is about its
 * unresolved doses. Vaccine and visit reminders are about a date, so they stay until tapped.
 */
export function isStale(url: string, { summary, kid, medicines, now }: Facts): boolean {
  const params = new URLSearchParams(url.split('?')[1] ?? '')
  const kind = params.get('log')
  if (kind === 'feed') return !!summary?.next_feed_due_at && Date.parse(summary.next_feed_due_at) > now
  if (kind === 'diaper') return !!summary?.last_diaper && !!kid && Date.parse(summary.last_diaper.at) + kid.diaper_alert_minutes * 60_000 > now
  if (kind === 'medicine') {
    const med = medicines.find((m) => m.id === params.get('med'))
    // an unknown medicine is not judged: the list may simply not have loaded yet
    return !!med && !med.slots.some((s) => (s.status === 'pending' || s.status === 'partial') && Date.parse(s.due_at) <= now)
  }
  return false
}

/** Closes reminders sitting in the notification tray whose entry has been logged (here or on another phone). */
export function useDismissStaleNotifications(facts: Facts) {
  const { summary, kid, medicines, now } = facts
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !summary) return
    let cancelled = false
    navigator.serviceWorker.ready
      .then((reg) => reg.getNotifications())
      .then((shown: Shown[]) => {
        if (cancelled) return
        for (const n of shown) if (n.data?.url && isStale(n.data.url, { summary, kid, medicines, now })) n.close()
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // the clock ticks every few seconds; what matters is the data, so re-check when it changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, kid, medicines])
}
