import { useQueryClient } from '@tanstack/react-query'
import { Moon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sleepRangeQuery, useMe, useSleepRange } from '../api/hooks'
import DayPager from '../components/DayPager'
import PageHeader from '../components/PageHeader'
import SleepDonut from '../components/SleepDonut'
import SleepForm from '../components/SleepForm'
import RowLink from '../components/RowLink'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty'
import { addDays, endOfDay, midnight, useStripRange } from '../lib/dayPager'
import { sleepDay } from '../lib/sleepDay'
import { formatAgo, formatTime, toLocalDate } from '../lib/time'
import { useNow } from '../lib/useNow'

/** One day of sleep: a 24-hour donut of asleep and awake, the sleeps that day, and past sleeps added. Fixing or deleting one happens in the timeline. */
export default function SleepDay() {
  const { t } = useTranslation()
  const canEdit = (useMe().data?.role ?? 'viewer') !== 'viewer'
  const now = useNow()
  const [day, setDay] = useState(() => midnight(new Date()))
  const todayMs = midnight(new Date(now)).getTime()
  const today = useMemo(() => new Date(todayMs), [todayMs])
  // a sleep that started the evening before still counts on this day, so fetch from a day earlier
  const range = useMemo(() => ({ from: addDays(day, -1), to: endOfDay(day) }), [day])
  const data = useSleepRange(range.from, range.to).data
  const sessions = Array.isArray(data) ? data : []
  const summary = sleepDay(sessions, day, new Date(now))
  const strip = useStripRange(day, todayMs)
  const stripData = useSleepRange(strip.from, strip.to).data
  // a sleep marks the day it started and the day it ended
  const marked = useMemo(
    () => new Set((Array.isArray(stripData) ? stripData : []).flatMap((s) => [s.started_at, s.ended_at].filter((x): x is string => !!x).map((x) => toLocalDate(new Date(x))))),
    [stripData],
  )
  const qc = useQueryClient()
  const prefetch = (d: Date) => void qc.prefetchQuery({ ...sleepRangeQuery(addDays(d, -1), endOfDay(d)), staleTime: 60_000 })
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
  const onDay = sessions
    .filter((s) => Date.parse(s.started_at) < dayEnd && (s.ended_at ? Date.parse(s.ended_at) : now) > day.getTime())
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)) // newest first, as every list of past entries
  const [form, setForm] = useState(false)

  return (
    <>
      <PageHeader title={t('sleep.dayTitle')} />
      <DayPager
        day={day}
        today={today}
        onDay={setDay}
        tone="sleep"
        prevLabel={t('sleep.prevDay')}
        nextLabel={t('sleep.nextDay')}
        marked={marked}
        onPrefetch={prefetch}
      >
      <Card className="py-6">{data !== undefined && <SleepDonut day={day} data={summary} />}</Card>
      {canEdit && (
        <Button variant="soft" className="w-full" onClick={() => setForm(true)}>
          {t('sleep.addPast')}
        </Button>
      )}
      {data !== undefined && onDay.length === 0 && <EmptyState icon={<Moon size={28} />} title={t('sleep.none')} />}
      <ul aria-label={t('sleep.listLabel')} className="space-y-2">
        {onDay.map((s) => (
          <li key={s.id}>
            <RowLink to={`/timeline?day=${toLocalDate(new Date(s.started_at))}&entry=sleep:${s.id}`} enabled={canEdit} label={t('timeline.edit')}>
              <Card tone="sleep" className="space-y-1 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{t('sleep.range', { from: formatTime(s.started_at), to: s.ended_at ? formatTime(s.ended_at) : t('sleep.ongoing') })}</span>
                  <span className="text-sm font-semibold text-sleep-ink">{formatAgo((s.ended_at ? Date.parse(s.ended_at) : now) - Date.parse(s.started_at))}</span>
                </div>
                <p className="text-sm text-muted">{[t('home.by', { name: s.started_by_name }), s.note].filter(Boolean).join(' · ')}</p>
              </Card>
            </RowLink>
          </li>
        ))}
      </ul>
      </DayPager>
      {form && <SleepForm onClose={() => setForm(false)} />}
    </>
  )
}
