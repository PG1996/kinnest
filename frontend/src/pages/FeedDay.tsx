import { useQueryClient } from '@tanstack/react-query'
import { Baby } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { feedRangeQuery, useFeedRange, useKid, useMe } from '../api/hooks'
import DayPager from '../components/DayPager'
import FeedClock from '../components/FeedClock'
import FeedGaps from '../components/FeedGaps'
import FeedEditForm from '../components/FeedEditForm'
import PageHeader from '../components/PageHeader'
import RowLink from '../components/RowLink'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty'
import { endOfDay, midnight, useStripRange } from '../lib/dayPager'
import { feedStats } from '../lib/feedDay'
import { formatAgo, formatTime, toLocalDate } from '../lib/time'
import { useNow } from '../lib/useNow'

/** One day of feeds: the totals, the list, and a past feed added. Fixing or deleting one happens in the timeline. */
export default function FeedDay() {
  const { t } = useTranslation()
  const canEdit = (useMe().data?.role ?? 'viewer') !== 'viewer'
  const now = useNow()
  const [day, setDay] = useState(() => midnight(new Date()))
  const todayMs = midnight(new Date(now)).getTime()
  const today = useMemo(() => new Date(todayMs), [todayMs])
  const range = useMemo(() => ({ from: day, to: endOfDay(day) }), [day])
  const data = useFeedRange(range.from, range.to).data
  const strip = useStripRange(day, todayMs)
  const stripData = useFeedRange(strip.from, strip.to).data
  const marked = useMemo(() => new Set((Array.isArray(stripData) ? stripData : []).map((f) => toLocalDate(new Date(f.started_at)))), [stripData])
  const qc = useQueryClient()
  const prefetch = (d: Date) => void qc.prefetchQuery({ ...feedRangeQuery(d, endOfDay(d)), staleTime: 60_000 })
  const rows = (Array.isArray(data) ? data : [])
    .filter((f) => Date.parse(f.started_at) >= range.from.getTime() && Date.parse(f.started_at) <= range.to.getTime())
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
  const stats = feedStats(rows)
  const [form, setForm] = useState(false)
  const interval = useKid().data?.feed_interval_minutes
  const stat = (value: string, name: string) => (
    <div>
      <span className="block text-xl font-bold tabular-nums">{value}</span>
      <span className="block text-[11px] font-semibold text-muted">{name}</span>
    </div>
  )

  return (
    <>
      <PageHeader title={t('feeds.title')} />
      <DayPager
        day={day}
        today={today}
        onDay={setDay}
        tone="feed"
        prevLabel={t('feeds.prevDay')}
        nextLabel={t('feeds.nextDay')}
        marked={marked}
        onPrefetch={prefetch}
      >
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
      </DayPager>
      {form && <FeedEditForm onClose={() => setForm(false)} />}
    </>
  )
}
