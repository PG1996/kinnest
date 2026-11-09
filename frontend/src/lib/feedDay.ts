import type { Feed } from '../api/hooks'

export type FeedStats = { count: number; ml: number; minutes: number; /** average time between the starts of consecutive feeds, null with fewer than two */ avgGapMin: number | null }

/** The day in numbers: feeds, bottle ml, breastfeeding minutes and the average gap between feeds. */
export function feedStats(feeds: Feed[]): FeedStats {
  const starts = feeds.map((f) => Date.parse(f.started_at)).sort((a, b) => a - b)
  const gaps = starts.slice(1).map((s, i) => s - starts[i]!)
  return {
    count: feeds.length,
    ml: feeds.reduce((n, f) => n + (f.quantity_ml ?? 0), 0),
    minutes: feeds.reduce((n, f) => n + (f.duration_min ?? 0), 0),
    avgGapMin: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length / 60_000) : null,
  }
}

export type FeedGap = { from: string; to: string; minutes: number }

/** The time from each feed's start to the next one's, oldest first. */
export function feedGaps(feeds: Feed[]): FeedGap[] {
  const sorted = [...feeds].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))
  return sorted.slice(1).map((f, i) => ({
    from: sorted[i]!.started_at,
    to: f.started_at,
    minutes: Math.round((Date.parse(f.started_at) - Date.parse(sorted[i]!.started_at)) / 60_000),
  }))
}
