import { useQueryClient } from '@tanstack/react-query'
import { Baby, CalendarDays, Droplets, HeartPulse, History, Moon, Pill, Syringe, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { timelineQuery, useMe, useTimeline } from '../api/hooks'
import AddPastEntry from '../components/AddPastEntry'
import DayChart, { LaneKey } from '../components/DayChart'
import DayPager from '../components/DayPager'
import { type StripTone } from '../components/DayStrip'
import EntryEditor, { canOpen } from '../components/EntryEditor'
import PageHeader from '../components/PageHeader'
import { Button } from '../components/ui/button'
import { Chip } from '../components/ui/chip'
import { EmptyState } from '../components/ui/empty'
import { cn } from '../lib/cn'
import { lanesFor, overlaps, PRESETS, toMarks, totals as addUp, zoomTo, type Lane, type Range, type Totals } from '../lib/dayChart'
import { addDays, endOfDay, midnight, useStripRange } from '../lib/dayPager'
import { formatAgo, formatTime, toLocalDate } from '../lib/time'
import { describe, fromQueue, type TimelineItem, type TimelineKind } from '../lib/timeline'
import { useNow } from '../lib/useNow'
import { useQueue } from '../offline/pending'

const ICONS: Record<TimelineKind, LucideIcon> = {
  feed: Baby,
  diaper: Droplets,
  sleep: Moon,
  dose: Pill,
  vital: HeartPulse,
  vaccine: Syringe,
  visit: CalendarDays,
}
const TINT: Record<string, string> = {
  feed: 'bg-feed-bg text-feed-ink',
  diaper: 'bg-diaper-bg text-diaper-ink',
  sleep: 'bg-sleep-bg text-sleep-ink',
  med: 'bg-med-bg text-med-ink',
  plain: 'bg-surface-2 text-ink',
  warn: 'bg-warn-bg text-warn-ink',
}

// the strip's dots and words for a day: one per kind of thing logged, in this order
const MARKS: { tone: StripTone; filter: string; kinds: TimelineKind[] }[] = [
  { tone: 'feed', filter: 'feed', kinds: ['feed'] },
  { tone: 'diaper', filter: 'diaper', kinds: ['diaper'] },
  { tone: 'sleep', filter: 'sleep', kinds: ['sleep'] },
  { tone: 'med', filter: 'dose', kinds: ['dose'] },
  { tone: 'primary', filter: 'health', kinds: ['vital', 'vaccine', 'visit'] },
]

const WHOLE: Range = { from: 0, to: 1440 }
const dayFromParam = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : null)

/** The words on a total's tile: what the range adds up to for that kind. */
function totalText(t: ReturnType<typeof useTranslation>['t'], lane: Lane, x: Totals): string {
  const parts = (...p: (string | false)[]) => p.filter(Boolean).join(' · ') || t('dayChart.totals.none')
  switch (lane) {
    case 'sleep':
      return x.sleep.minutes ? formatAgo(x.sleep.minutes * 60_000) : t('dayChart.totals.none')
    case 'feed':
      return x.feed.count
        ? parts(
            t('dayChart.totals.feedCount', { count: x.feed.count }),
            x.feed.ml > 0 && t('dayChart.totals.ml', { n: x.feed.ml }),
            x.feed.breastMin > 0 && t('dayChart.totals.breastMin', { n: x.feed.breastMin }),
          )
        : t('dayChart.totals.none')
    case 'diaper':
      return x.diaper.count
        ? parts(
            String(x.diaper.count),
            x.diaper.wet > 0 && t('dayChart.totals.wet', { n: x.diaper.wet }),
            x.diaper.dirty > 0 && t('dayChart.totals.dirty', { n: x.diaper.dirty }),
            x.diaper.both > 0 && t('dayChart.totals.both', { n: x.diaper.both }),
          )
        : t('dayChart.totals.none')
    case 'dose':
      return x.dose.given || x.dose.skipped
        ? parts(
            x.dose.given > 0 && t('dayChart.totals.doses', { count: x.dose.given }),
            x.dose.skipped > 0 && t('dayChart.totals.skipped', { n: x.dose.skipped }),
          )
        : t('dayChart.totals.none')
    case 'vital':
      return x.vital.count ? t('dayChart.totals.readings', { count: x.vital.count }) : t('dayChart.totals.none')
    case 'health':
      return parts(
        x.health.visits > 0 && t('dayChart.totals.visits', { count: x.health.visits }),
        x.health.vaccines > 0 && t('dayChart.totals.vaccines', { count: x.health.vaccines }),
      )
  }
}

function EntryRow({ it, role, onOpen }: { it: TimelineItem; role: string; onOpen: (it: TimelineItem) => void }) {
  const { t } = useTranslation()
  const d = describe(it, t)
  const Icon = ICONS[it.kind]
  const inner = (
    <>
      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', TINT[d.tone])}>
        <Icon size={20} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{d.title}</span>
        <span className="block truncate text-sm text-muted">{[d.meta, it.pending ? t('timeline.pendingSync') : ''].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="text-sm font-bold text-muted">{formatTime(it.at)}</span>
    </>
  )
  const row = 'flex w-full items-center gap-3 rounded-tile bg-surface p-3 text-left shadow-sm'
  return (
    <li>
      {canOpen(it, role) ? (
        <button type="button" onClick={() => onOpen(it)} className={cn(row, 'active:bg-surface-2')}>
          {inner}
        </button>
      ) : (
        <div className={row}>{inner}</div>
      )}
    </li>
  )
}

/**
 * Everything logged on one day: a chart of the day in lanes, the totals for each kind, and the list, newest first. Pick a
 * range on the chart (or a quick range) and the totals and the list narrow to it. Swipe or use the strip for other days.
 * On a phone turned sideways the chart takes the left side and the totals and list the right.
 */
export default function Timeline() {
  const { t } = useTranslation()
  const me = useMe().data
  const role = me?.role ?? 'viewer'
  const myName = me?.user.name ?? ''
  const [params, setParams] = useSearchParams()
  const entry = params.get('entry')
  const now = useNow()
  const today = useMemo(() => midnight(new Date(now)), [now])
  const [day, setDay] = useState(() => dayFromParam(params.get('day')) ?? midnight(new Date()))
  const [range, setRange] = useState<Range | null>(null)
  const [view, setView] = useState<Range>(WHOLE)
  const [hidden, setHidden] = useState<Set<Lane>>(() => new Set())
  const [opened, setOpened] = useState<TimelineItem | null>(null)
  const [adding, setAdding] = useState(false)

  const showDay = (d: Date) => {
    setDay(d)
    setRange(null)
    setView(WHOLE)
  }

  // one fetch for the day and the night before it, so a sleep that ran past midnight shows from the start of the day
  const from = useMemo(() => addDays(day, -1), [day])
  const to = useMemo(() => endOfDay(day), [day])
  const server = useTimeline({ from, to }).data
  const pending = useQueue().pending
  const items: TimelineItem[] = useMemo(() => {
    const queued = fromQueue(pending, day, myName)
    const known = new Set((Array.isArray(server) ? server : []).map((i) => `${i.kind}:${i.id}`))
    return [...queued.filter((i) => !known.has(`${i.kind}:${i.id}`)), ...(Array.isArray(server) ? server : [])]
  }, [server, pending, day, myName])
  const marks = useMemo(() => toMarks(items, day, now), [items, day, now])
  const lanes = lanesFor(marks)
  const shownLanes = lanes.filter((l) => !hidden.has(l))
  const sum = addUp(marks, range)
  const listed = marks.filter((m) => !hidden.has(m.lane) && overlaps(m, range)).sort((a, b) => Date.parse(b.item.at) - Date.parse(a.item.at))
  const isToday = day.getTime() === today.getTime()
  const nowMin = isToday ? Math.round((now - day.getTime()) / 60_000) : null

  const qc = useQueryClient()
  const prefetch = (d: Date) => void qc.prefetchQuery({ ...timelineQuery(addDays(d, -1), endOfDay(d)), staleTime: 60_000 })

  const openEntry = useCallback(
    (it: TimelineItem) => {
      setOpened(it)
      if (params.has('entry')) {
        params.delete('entry')
        params.delete('day')
        setParams(params, { replace: true })
      }
    },
    [params, setParams],
  )
  // a link such as /timeline?entry=sleep:<id> opens that entry as soon as it shows up
  useEffect(() => {
    const hit = entry && items.find((i) => `${i.kind}:${i.id}` === entry)
    if (hit && canOpen(hit, role)) openEntry(hit)
  }, [entry, items, role, openEntry])

  // the strip's dots: one per kind logged that day
  const strip = useStripRange(day, today.getTime())
  const stripItems = useTimeline({ from: strip.from, to: strip.to }).data
  const logged = useMemo(() => {
    const byDay = new Map<string, Set<TimelineKind>>()
    for (const it of Array.isArray(stripItems) ? stripItems : []) {
      const key = toLocalDate(new Date(it.at))
      if (!byDay.has(key)) byDay.set(key, new Set())
      byDay.get(key)!.add(it.kind)
    }
    return byDay
  }, [stripItems])
  const marksOf = (d: Date) => MARKS.filter((m) => m.kinds.some((k) => logged.get(toLocalDate(d))?.has(k)))

  const clock = (m: number) => (m >= 1440 ? t('dayChart.midnight') : formatTime(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m)))
  const title = range ? t('dayChart.range', { from: clock(range.from), to: clock(range.to) }) : t('dayChart.wholeDay')
  const zoomed = view.from !== WHOLE.from || view.to !== WHOLE.to
  const toggle = (l: Lane) =>
    setHidden((h) => {
      const n = new Set(h)
      if (n.has(l)) n.delete(l)
      else n.add(l)
      return n
    })

  return (
    <>
      <PageHeader title={t('timeline.title')} />
      {role !== 'viewer' && (
        <Button variant="soft" className="w-full" onClick={() => setAdding(true)}>
          {t('timeline.addPast')}
        </Button>
      )}
      <DayPager
        day={day}
        today={today}
        onDay={showDay}
        tone="primary"
        prevLabel={t('timeline.prevDay')}
        nextLabel={t('timeline.nextDay')}
        marks={(d) => marksOf(d).map((m) => m.tone)}
        describe={(d) =>
          marksOf(d)
            .map((m) => t(`timeline.filters.${m.filter}`))
            .join(', ')
        }
        stripClassName="land:hidden"
        onPrefetch={prefetch}
      >
        <div className="space-y-4 land:grid land:grid-cols-[3fr_2fr] land:items-start land:gap-3 land:space-y-0">
          <section aria-label={t('dayChart.label')} className="space-y-2 rounded-card bg-surface p-3 shadow-sm land:sticky land:top-2">
            <div className="flex min-h-8 items-center justify-between gap-2">
              <h2 className="min-w-0 truncate text-sm font-bold tabular-nums">{title}</h2>
              {range && (
                <div className="flex shrink-0 gap-1.5">
                  <Chip pressed={zoomed} onClick={() => setView(zoomed ? WHOLE : zoomTo(range))}>
                    {t(zoomed ? 'dayChart.zoomed' : 'dayChart.zoom')}
                  </Chip>
                  <Chip pressed={false} onClick={() => showDay(day)}>
                    {t('dayChart.wholeDay')}
                  </Chip>
                </div>
              )}
            </div>
            <div role="group" aria-label={t('dayChart.presetsLabel')} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 [scrollbar-width:none]">
              {PRESETS.map((p) => {
                const on = range?.from === p.from && range?.to === p.to
                return (
                  <Chip
                    key={p.id}
                    pressed={on}
                    className="shrink-0"
                    onClick={() => {
                      setView(WHOLE)
                      setRange(on ? null : { from: p.from, to: p.to })
                    }}
                  >
                    {t(`dayChart.presets.${p.id}`)}
                  </Chip>
                )
              })}
            </div>
            <DayChart marks={marks.filter((m) => !hidden.has(m.lane))} lanes={shownLanes} range={range} view={view} onRange={setRange} nowMin={nowMin} />
            <p className="text-center text-xs text-muted land:hidden">{t('dayChart.hint')}</p>
          </section>
          <div className="space-y-3">
            <div role="group" aria-label={t('dayChart.totalsLabel')} className="grid grid-cols-2 gap-2 land:grid-cols-1 land:gap-1.5">
              {lanes.map((l) => {
                const on = !hidden.has(l)
                const name = t(`dayChart.lanes.${l}`)
                const total = totalText(t, l, sum)
                return (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={on}
                    aria-label={t(on ? 'dayChart.hide' : 'dayChart.show', { name, total })}
                    onClick={() => toggle(l)}
                    className={cn(
                      'flex min-w-0 items-center gap-2 rounded-tile border-[1.5px] px-3 py-2 text-left',
                      on ? 'border-transparent bg-surface shadow-sm' : 'border-dashed border-line bg-transparent',
                    )}
                  >
                    <span className={on ? '' : 'opacity-40'}>
                      <LaneKey lane={l} />
                    </span>
                    <span className="min-w-0 flex-1 land:flex land:items-baseline land:justify-between land:gap-2">
                      <span className={cn('block text-[13px] font-bold', !on && 'opacity-50')}>{name}</span>
                      <span className="block truncate text-xs font-bold text-muted tabular-nums">{total}</span>
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="flex items-baseline justify-between px-1">
              <span className="text-[13px] font-semibold text-muted">{title}</span>
              <span className="text-xs font-bold text-muted">{t('dayChart.entries', { count: listed.length })}</span>
            </div>
            {server !== undefined &&
              listed.length === 0 &&
              (range ? (
                <p className="rounded-tile bg-surface p-4 text-center text-sm text-muted">{t('dayChart.emptyRange')}</p>
              ) : (
                <EmptyState icon={<History size={28} />} title={t('timeline.empty')} />
              ))}
            <ul className="space-y-2">
              {listed.map((m) => (
                <EntryRow key={`${m.item.kind}-${m.item.id}`} it={m.item} role={role} onOpen={openEntry} />
              ))}
            </ul>
          </div>
        </div>
      </DayPager>
      {opened && <EntryEditor key={`${opened.kind}-${opened.id}`} item={opened} onClose={() => setOpened(null)} />}
      {adding && <AddPastEntry isAdmin={role === 'admin'} onClose={() => setAdding(false)} />}
    </>
  )
}
