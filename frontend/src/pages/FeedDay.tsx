import { Baby, ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFeedRange, useKid, useMe } from '../api/hooks'
import FeedClock from '../components/FeedClock'
import FeedGaps from '../components/FeedGaps'
import FeedEditForm from '../components/FeedEditForm'
import PageHeader from '../components/PageHeader'
import RowLink from '../components/RowLink'
import { Button, IconButton } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty'
import { feedStats } from '../lib/feedDay'
import { formatAgo, formatTime, toLocalDate } from '../lib/time'
import { useNow } from '../lib/useNow'

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** One day of feeds: the totals, the list, and a past feed added. Fixing or deleting one happens in the timeline. */
export default function FeedDay() {
  const { t } = useTranslation()
  const canEdit = (useMe().data?.role ?? 'viewer') !== 'viewer'
  const now = useNow()
  const [day, setDay] = useState(() => midnight(new Date()))
  const isToday = day.getTime() === midnight(new Date(now)).getTime()
  const range = useMemo(() => ({ from: day, to: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999) }), [day])
  const data = useFeedRange(range.from, range.to).data
  const rows = (Array.isArray(data) ? data : [])
    .filter((f) => Date.parse(f.started_at) >= range.from.getTime() && Date.parse(f.started_at) <= range.to.getTime())
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
  const stats = feedStats(rows)
  const [form, setForm] = useState(false)
  const interval = useKid().data?.feed_interval_minutes
  const shift = (days: number) => setDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() + days))
  const label = isToday ? t('timeline.today') : day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
  const stat = (value: string, name: string) => (
    <div>
      <span className="block text-xl font-bold tabular-nums">{value}</span>
      <span className="block text-[11px] font-semibold text-muted">{name}</span>
    </div>
  )

  return (
    <>
      <PageHeader title={t('feeds.title')} />
      <div className="flex items-center justify-between">
        <IconButton label={t('feeds.prevDay')} onClick={() => shift(-1)}>
          <ChevronLeft size={20} aria-hidden="true" />
        </IconButton>
        <span className="font-semibold">{label}</span>
        <IconButton label={t('feeds.nextDay')} onClick={() => shift(1)} disabled={isToday} className="disabled:opacity-40">
          <ChevronRight size={20} aria-hidden="true" />
        </IconButton>
      </div>
      <Card tone="feed" className="p-3">
        <div data-testid="feed-stats" className="grid grid-cols-4 gap-2 text-center">
          {stat(String(stats.count), t('feeds.statFeeds'))}
          {stat(`${stats.ml} ml`, t('feeds.statBottle'))}
          {stat(`${stats.minutes} min`, t('feeds.statBreast'))}
          {stat(stats.avgGapMin !== null ? formatAgo(stats.avgGapMin * 60_000) : '–', t('feeds.statGap'))}
        </div>
      </Card>
      {data !== undefined && (
        <Card className="py-6">
          <FeedClock day={day} feeds={rows} />
        </Card>
      )}
      {rows.length > 1 && (
        <Card className="space-y-2 p-4">
          <h2 className="text-sm font-semibold text-muted">{t('feeds.gapsTitle')}</h2>
          <FeedGaps feeds={rows} intervalMin={interval} />
        </Card>
      )}
      {canEdit && (
        <Button variant="soft" className="w-full" onClick={() => setForm(true)}>
          {t('feeds.addPast')}
        </Button>
      )}
      {data !== undefined && rows.length === 0 && <EmptyState icon={<Baby size={28} />} title={t('feeds.none')} />}
      <ul aria-label={t('feeds.listLabel')} className="space-y-2">
        {rows.map((f) => (
          <li key={f.id}>
            <RowLink to={`/timeline?day=${toLocalDate(new Date(f.started_at))}&entry=feed:${f.id}`} enabled={canEdit} label={t('timeline.edit')}>
              <Card tone="feed" className="space-y-1 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    {[t(`feedTypes.${f.type}`), f.quantity_ml != null ? `${f.quantity_ml} ml` : null, f.duration_min != null ? `${f.duration_min} min` : null].filter(Boolean).join(' · ')}
                  </span>
                  <span className="text-sm font-semibold text-feed-ink">{formatTime(f.started_at)}</span>
                </div>
                <p className="text-sm text-muted">{[t('home.by', { name: f.fed_by_name }), f.break_min ? t('feed.breakTotal', { n: f.break_min }) : '', f.note].filter(Boolean).join(' · ')}</p>
              </Card>
            </RowLink>
          </li>
        ))}
      </ul>
      {form && <FeedEditForm onClose={() => setForm(false)} />}
    </>
  )
}
