import { Baby, CalendarDays, Droplets, HeartPulse, Moon, Pill, Syringe, type LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMe, useTimeline } from '../api/hooks'
import PageHeader from '../components/PageHeader'
import { Button } from '../components/ui/button'
import { Chip } from '../components/ui/chip'
import { EmptyState } from '../components/ui/empty'
import { Input } from '../components/ui/field'
import { cn } from '../lib/cn'
import { formatTime, toLocalDate } from '../lib/time'
import { dayRange, describe, fromQueue, type TimelineItem, type TimelineKind } from '../lib/timeline'
import { useQueue } from '../offline/pending'
import { History } from 'lucide-react'

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

function DaySection({ day, kinds, myName }: { day: Date; kinds?: TimelineKind[]; myName: string }) {
  const { t } = useTranslation()
  const { from, to } = useMemo(() => dayRange(day), [day])
  const server = useTimeline({ from, to, kinds }).data
  const pending = useQueue().pending
  const items: TimelineItem[] = useMemo(() => {
    const queued = fromQueue(pending, day, myName).filter((i) => !kinds || kinds.includes(i.kind))
    const known = new Set((server ?? []).map((i) => i.id))
    return [...queued.filter((i) => !known.has(i.id)), ...(server ?? [])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  }, [server, pending, day, kinds, myName])
  const now = new Date()
  const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - from.getTime()) / 86_400_000)
  const date = day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
  const heading = diff === 0 ? `${t('timeline.today')} · ${date}` : diff === 1 ? `${t('timeline.yesterday')} · ${date}` : date
  return (
    <section className="space-y-2">
      <h2 className="text-[13px] font-semibold text-muted">{heading}</h2>
      {server !== undefined && items.length === 0 && <EmptyState icon={<History size={28} />} title={t('timeline.empty')} />}
      <ul className="space-y-2">
        {items.map((it) => {
          const d = describe(it, t)
          const Icon = ICONS[it.kind]
          return (
            <li key={`${it.kind}-${it.id}`} className="flex items-center gap-3 rounded-tile bg-surface p-3 shadow-sm">
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
  const [start, setStart] = useState(() => toLocalDate(new Date()))
  const [count, setCount] = useState(1)
  const kinds = FILTERS.find((f) => f.id === filter)?.kinds
  const days = useMemo(() => Array.from({ length: count }, (_, i) => new Date(startOf(start).getTime() - i * 86_400_000)), [start, count])
  return (
    <>
      <PageHeader
        title={t('timeline.title')}
        actions={
          <Input
            type="date"
            aria-label={t('timeline.pickDay')}
            value={start}
            max={toLocalDate(new Date())}
            onChange={(e) => {
              if (e.target.value) {
                setStart(e.target.value)
                setCount(1)
              }
            }}
            className="min-h-11 w-auto px-3 text-sm"
          />
        }
      />
      <div role="group" aria-label={t('timeline.filterLabel')} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <Chip key={f.id} pressed={filter === f.id} onClick={() => setFilter(f.id)} className="shrink-0">
            {t(`timeline.filters.${f.id}`)}
          </Chip>
        ))}
      </div>
      {days.map((d) => (
        <DaySection key={d.toISOString()} day={d} kinds={kinds} myName={me?.user.name ?? ''} />
      ))}
      <Button variant="soft" className="w-full" onClick={() => setCount(count + 1)}>
        {t('timeline.earlier')}
      </Button>
    </>
  )
}
