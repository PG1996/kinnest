import { Baby, CalendarDays, Droplets, HeartPulse, Moon, Pill, Syringe, type LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useMe, useTimeline } from '../api/hooks'
import AddPastEntry from '../components/AddPastEntry'
import EntryEditor, { canOpen } from '../components/EntryEditor'
import PageHeader from '../components/PageHeader'
import { Button } from '../components/ui/button'
import { Chip } from '../components/ui/chip'
import { EmptyState } from '../components/ui/empty'
import { cn } from '../lib/cn'
import { formatTime, toLocalDate } from '../lib/time'
import { dayRange, describe, fromQueue, type TimelineItem, type TimelineKind } from '../lib/timeline'
import { useQueue } from '../offline/pending'
import { History } from 'lucide-react'
import { DateField } from '../components/ui/datetime'
import DayStrip, { type StripTone } from '../components/DayStrip'
import { midnight, useStripRange } from '../lib/dayPager'
import { prefersReducedMotion } from '../lib/motion'
import { useNow } from '../lib/useNow'

const FILTERS: { id: string; kinds?: TimelineKind[] }[] = [
  { id: 'all' },
  { id: 'feed', kinds: ['feed'] },
  { id: 'diaper', kinds: ['diaper'] },
  { id: 'sleep', kinds: ['sleep'] },
  { id: 'dose', kinds: ['dose'] },
  { id: 'vital', kinds: ['vital'] },
  { id: 'health', kinds: ['vaccine', 'visit'] },
]

const ICONS: Record<TimelineKind, LucideIcon> = { feed: Baby, diaper: Droplets, sleep: Moon, dose: Pill, vital: HeartPulse, vaccine: Syringe, visit: CalendarDays }
const TINT: Record<string, string> = {
  feed: 'bg-feed-bg text-feed-ink',
  diaper: 'bg-diaper-bg text-diaper-ink',
  sleep: 'bg-sleep-bg text-sleep-ink',
  med: 'bg-med-bg text-med-ink',
  plain: 'bg-surface-2 text-ink',
  warn: 'bg-warn-bg text-warn-ink',
}

const startOf = (iso: string) => new Date(`${iso}T12:00:00`)
const daysBetween = (later: string, earlier: string) => Math.round((startOf(later).getTime() - startOf(earlier).getTime()) / 86_400_000)

// the strip's dots and words for a day: one per kind of thing logged, in this order
const MARKS: { tone: StripTone; filter: string; kinds: TimelineKind[] }[] = [
  { tone: 'feed', filter: 'feed', kinds: ['feed'] },
  { tone: 'diaper', filter: 'diaper', kinds: ['diaper'] },
  { tone: 'sleep', filter: 'sleep', kinds: ['sleep'] },
  { tone: 'med', filter: 'dose', kinds: ['dose'] },
  { tone: 'primary', filter: 'health', kinds: ['vital', 'vaccine', 'visit'] },
]
// days loaded by reaching the end of the list; after that, the Earlier day button
const AUTO_DAYS = 60

function DaySection({ day, kinds, myName, role, entry, onOpen }: { day: Date; kinds?: TimelineKind[]; myName: string; role: string; entry: string | null; onOpen: (it: TimelineItem) => void }) {
  const { t } = useTranslation()
  const { from, to } = useMemo(() => dayRange(day), [day])
  const server = useTimeline({ from, to, kinds }).data
  const pending = useQueue().pending
  const items: TimelineItem[] = useMemo(() => {
    const queued = fromQueue(pending, day, myName).filter((i) => !kinds || kinds.includes(i.kind))
    const known = new Set((server ?? []).map((i) => i.id))
    return [...queued.filter((i) => !known.has(i.id)), ...(server ?? [])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  }, [server, pending, day, kinds, myName])
  // a link such as /timeline?entry=sleep:<id> opens that entry as soon as it shows up
  useEffect(() => {
    const hit = entry && items.find((i) => `${i.kind}:${i.id}` === entry)
    if (hit && canOpen(hit, role)) onOpen(hit)
  }, [entry, items, role, onOpen])
  const now = new Date()
  const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - from.getTime()) / 86_400_000)
  const date = day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
  const heading = diff === 0 ? `${t('timeline.today')} · ${date}` : diff === 1 ? `${t('timeline.yesterday')} · ${date}` : date
  return (
    // scroll-mt keeps a day's heading clear of the sticky strip when the strip scrolls to it
    <section data-day={toLocalDate(day)} className="scroll-mt-20 space-y-2">
      <h2 className="text-[13px] font-semibold text-muted">{heading}</h2>
      {server !== undefined && items.length === 0 && <EmptyState icon={<History size={28} />} title={t('timeline.empty')} />}
      <ul className="space-y-2">
        {items.map((it) => {
          const d = describe(it, t)
          const Icon = ICONS[it.kind]
          const inner = (
            <>
              <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', TINT[d.tone])}>
                <Icon size={20} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{d.title}</span>
                <span className="block truncate text-sm text-muted">
                  {[d.meta, it.pending ? t('timeline.pendingSync') : ''].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="text-sm font-bold text-muted">{formatTime(it.at)}</span>
            </>
          )
          const row = 'flex w-full items-center gap-3 rounded-tile bg-surface p-3 text-left shadow-sm'
          return (
            <li key={`${it.kind}-${it.id}`}>
              {canOpen(it, role) ? (
                <button type="button" onClick={() => onOpen(it)} className={cn(row, 'active:bg-surface-2')}>
                  {inner}
                </button>
              ) : (
                <div className={row}>{inner}</div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Everything logged, newest first, one day at a time; filter by kind, pick a day, or load earlier days. */
export default function Timeline() {
  const { t } = useTranslation()
  const me = useMe().data
  const [filter, setFilter] = useState('all')
  const [params, setParams] = useSearchParams()
  // a link can name the day to show (the day of the entry it opens)
  const [start, setStart] = useState(() => (/^\d{4}-\d{2}-\d{2}$/.test(params.get('day') ?? '') ? params.get('day')! : toLocalDate(new Date())))
  const [count, setCount] = useState(1)
  const entry = params.get('entry')
  const role = me?.role ?? 'viewer'
  const [opened, setOpened] = useState<TimelineItem | null>(null)
  const [adding, setAdding] = useState(false)
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
  const kinds = FILTERS.find((f) => f.id === filter)?.kinds
  const days = useMemo(() => Array.from({ length: count }, (_, i) => new Date(startOf(start).getTime() - i * 86_400_000)), [start, count])

  // the strip: the day at the top of the list is the chosen one; tapping a day scrolls the list to it
  const [active, setActive] = useState(start)
  const todayMs = midnight(new Date(useNow())).getTime()
  const activeDay = useMemo(() => midnight(startOf(active)), [active])
  const strip = useStripRange(activeDay, todayMs)
  const stripItems = useTimeline({ from: strip.from, to: strip.to, kinds }).data
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
  const stripWrap = useRef<HTMLDivElement>(null)
  const scrollTo = useRef<string | null>(null)

  const pickDay = (d: Date) => {
    const iso = toLocalDate(d)
    const oldest = toLocalDate(new Date(startOf(start).getTime() - (count - 1) * 86_400_000))
    if (iso > start) {
      setStart(iso)
      setCount(count + daysBetween(iso, start))
    } else if (iso < oldest) setCount(daysBetween(start, iso) + 1)
    setActive(iso)
    scrollTo.current = iso
  }
  const jumpTo = (iso: string) => {
    setStart(iso)
    setCount(1)
    setActive(iso)
    scrollTo.current = iso
  }

  // after a tap, bring that day to the top, under the strip
  useEffect(() => {
    const iso = scrollTo.current
    if (!iso) return
    const el = document.querySelector<HTMLElement>(`[data-day="${iso}"]`)
    if (!el) return
    scrollTo.current = null
    el.scrollIntoView?.({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  })

  // while the list scrolls, the strip follows the day at its top
  useEffect(() => {
    const pending = { frame: 0 }
    const later = window.requestAnimationFrame?.bind(window) ?? ((cb: () => void) => window.setTimeout(cb, 16))
    const onScroll = () => {
      if (pending.frame) return
      pending.frame = later(() => {
        pending.frame = 0
        const limit = (stripWrap.current?.getBoundingClientRect().bottom ?? 0) + 8
        let top: string | undefined
        for (const el of document.querySelectorAll<HTMLElement>('[data-day]')) {
          if (!top) top = el.dataset.day
          if (el.getBoundingClientRect().top <= limit) top = el.dataset.day
          else break
        }
        if (top) setActive(top)
      }) as number
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // reaching the end of the list loads the day before, up to a couple of months; then the button
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || !end.current || count >= AUTO_DAYS) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setCount((c) => c + 1)
    }, { rootMargin: '600px 0px' })
    io.observe(end.current)
    return () => io.disconnect()
  }, [count])
  return (
    <>
      <PageHeader
        title={t('timeline.title')}
        actions={
          <DateField
            label={t('timeline.pickDay')}
            labelled={false}
            compact
            value={start}
            onChange={(v) => {
              if (v) jumpTo(v)
            }}
            className="min-h-11 w-auto"
          />
        }
      />
      {role !== 'viewer' && (
        <Button variant="soft" className="w-full" onClick={() => setAdding(true)}>
          {t('timeline.addPast')}
        </Button>
      )}
      <div role="group" aria-label={t('timeline.filterLabel')} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <Chip key={f.id} pressed={filter === f.id} onClick={() => setFilter(f.id)} className="shrink-0">
            {t(`timeline.filters.${f.id}`)}
          </Chip>
        ))}
      </div>
      <div ref={stripWrap} className="sticky top-[env(safe-area-inset-top)] z-10 -mx-4 bg-app px-4 py-2">
        <DayStrip
          days={strip.days}
          selected={activeDay}
          onPick={pickDay}
          tone="primary"
          marks={(d) => marksOf(d).map((m) => m.tone)}
          describe={(d) => marksOf(d).map((m) => t(`timeline.filters.${m.filter}`)).join(', ')}
        />
      </div>
      {days.map((d) => (
        <DaySection key={d.toISOString()} day={d} kinds={kinds} myName={me?.user.name ?? ''} role={role} entry={entry} onOpen={openEntry} />
      ))}
      <div ref={end} aria-hidden="true" />
      <Button variant="soft" className="w-full" onClick={() => setCount(count + 1)}>
        {t('timeline.earlier')}
      </Button>
      {opened && <EntryEditor key={`${opened.kind}-${opened.id}`} item={opened} onClose={() => setOpened(null)} />}
      {adding && <AddPastEntry isAdmin={role === 'admin'} onClose={() => setAdding(false)} />}
    </>
  )
}
