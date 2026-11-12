import type { TimelineItem, TimelineKind } from './timeline'

/**
 * The rules behind the Timeline's day chart, kept apart from drawing so they can be tested: which lane an entry goes in,
 * where it sits (minutes since the day's midnight), what a tap picks, and what the totals add up to.
 */

export type Lane = 'sleep' | 'feed' | 'diaper' | 'dose' | 'vital' | 'health'
/** Top to bottom. `health` (visits and vaccines) only shows on days that have one. */
export const LANES: Lane[] = ['sleep', 'feed', 'diaper', 'dose', 'vital', 'health']
export const laneOf = (k: TimelineKind): Lane => (k === 'vaccine' || k === 'visit' ? 'health' : k)
/** The timeline kinds behind a lane. */
export const KINDS_OF: Record<Lane, TimelineKind[]> = {
  sleep: ['sleep'],
  feed: ['feed'],
  diaper: ['diaper'],
  dose: ['dose'],
  vital: ['vital'],
  health: ['visit', 'vaccine'],
}

export type Range = { from: number; to: number }

export type Mark = {
  item: TimelineItem
  lane: Lane
  /** minutes since the day's midnight, cut to the day */
  from: number
  to: number
  /** drawn as a bar (has a length) rather than a shape at one moment */
  bar: boolean
  /** still going (a sleep with no end yet): runs to now */
  live: boolean
  skipped: boolean
}

const MIN = 60_000
const str = (v: unknown) => (typeof v === 'string' ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** The day's entries as marks. `items` may include the night before, so a sleep that ran into the day starts at midnight. */
export function toMarks(items: TimelineItem[], day: Date, now: number): Mark[] {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
  const span = (end - start) / MIN
  const out: Mark[] = []
  for (const item of items) {
    const d = item.data
    let s = Date.parse(item.at)
    let e = s
    let bar = false
    let live = false
    if (item.kind === 'sleep') {
      s = Date.parse(str(d.started_at) ?? item.at)
      const ended = str(d.ended_at)
      if (ended) e = Date.parse(ended)
      else {
        live = true
        e = Math.min(now, end)
      }
      bar = true
    } else if (item.kind === 'feed' && String(d.type ?? '').startsWith('breast') && num(d.duration_min) > 0) {
      e = s + (num(d.duration_min) + num(d.break_min)) * MIN
      bar = true
    }
    if (e < start || s >= end || e < s) continue
    out.push({
      item,
      lane: laneOf(item.kind),
      from: Math.max(0, (s - start) / MIN),
      to: Math.min(span, (e - start) / MIN),
      bar,
      live,
      skipped: item.kind === 'dose' && d.status === 'skipped',
    })
  }
  return out
}

/** The lanes to draw for these marks. */
export const lanesFor = (marks: Mark[]): Lane[] => LANES.filter((l) => l !== 'health' || marks.some((m) => m.lane === 'health'))

/** Does a mark touch the range? No range means the whole day. */
export const overlaps = (m: Mark, r: Range | null) => !r || (m.from <= r.to && m.to >= r.from)

/** What tapping a mark picks: a bar's span, or 10 minutes either side of a moment. */
export function markRange(m: Mark, span = 1440): Range {
  if (m.bar) return { from: m.from, to: m.to }
  return { from: Math.max(0, m.from - 10), to: Math.min(span, m.from + 10) }
}

/**
 * Rows for moments in one lane, given their x positions (sorted) and half a shape's width: each goes in the first row where
 * it doesn't touch a shape already there; past the last row it gets -1 (shown as a "+N" badge).
 */
export function packMoments(xs: number[], half: number, rows: number): number[] {
  const taken: [number, number][][] = Array.from({ length: rows }, () => [])
  return xs.map((x) => {
    const row = taken.findIndex((r) => !r.some(([a, b]) => x - half < b && x + half > a))
    if (row >= 0) taken[row].push([x - half, x + half])
    return row
  })
}

export type Totals = {
  sleep: { minutes: number }
  feed: { count: number; ml: number; breastMin: number }
  diaper: { count: number; wet: number; dirty: number; both: number }
  dose: { given: number; skipped: number }
  vital: { count: number }
  health: { visits: number; vaccines: number }
}

/** What the marks in the range add up to. Sleep counts only the minutes inside the range. */
export function totals(marks: Mark[], r: Range | null): Totals {
  const t: Totals = {
    sleep: { minutes: 0 },
    feed: { count: 0, ml: 0, breastMin: 0 },
    diaper: { count: 0, wet: 0, dirty: 0, both: 0 },
    dose: { given: 0, skipped: 0 },
    vital: { count: 0 },
    health: { visits: 0, vaccines: 0 },
  }
  for (const m of marks) {
    if (!overlaps(m, r)) continue
    const d = m.item.data
    switch (m.lane) {
      case 'sleep':
        t.sleep.minutes += Math.max(0, Math.min(r?.to ?? m.to, m.to) - Math.max(r?.from ?? m.from, m.from))
        break
      case 'feed':
        t.feed.count++
        t.feed.ml += num(d.quantity_ml)
        if (String(d.type ?? '').startsWith('breast')) t.feed.breastMin += num(d.duration_min)
        break
      case 'diaper': {
        t.diaper.count++
        const k = d.kind as 'wet' | 'dirty' | 'both'
        if (k in t.diaper) t.diaper[k]++
        break
      }
      case 'dose':
        if (m.skipped) t.dose.skipped++
        else t.dose.given++
        break
      case 'vital':
        t.vital.count++
        break
      case 'health':
        if (m.item.kind === 'visit') t.health.visits++
        else t.health.vaccines++
    }
  }
  t.sleep.minutes = Math.round(t.sleep.minutes)
  return t
}

const STEPS = [15, 30, 60, 120, 180, 360]
/** Minutes between hour lines: the closest spacing that keeps them at least 36px apart. */
export const tickStep = (spanMin: number, widthPx: number) => STEPS.find((s) => (s / spanMin) * widthPx >= 36) ?? 360

/** The view for "Zoom": the range with a little room either side, inside the day. */
export function zoomTo(r: Range, span = 1440): Range {
  const pad = Math.max(5, (r.to - r.from) * 0.08)
  return { from: Math.max(0, Math.round(r.from - pad)), to: Math.min(span, Math.round(r.to + pad)) }
}

export const PRESETS: { id: 'night' | 'morning' | 'afternoon' | 'evening'; from: number; to: number }[] = [
  { id: 'night', from: 0, to: 360 },
  { id: 'morning', from: 360, to: 720 },
  { id: 'afternoon', from: 720, to: 1080 },
  { id: 'evening', from: 1080, to: 1440 },
]
