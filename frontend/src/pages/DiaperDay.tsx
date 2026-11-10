import { useQueryClient } from '@tanstack/react-query'
import { Droplets } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { diaperRangeQuery, useDiaperRange, useMe } from '../api/hooks'
import DayPager from '../components/DayPager'
import DiaperForm from '../components/DiaperForm'
import DiaperStrips from '../components/DiaperStrips'
import DiaperTiles from '../components/DiaperTiles'
import PageHeader from '../components/PageHeader'
import RowLink from '../components/RowLink'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty'
import { addDays, endOfDay, midnight, useStripRange } from '../lib/dayPager'
import { diaperStats } from '../lib/diaperDays'
import { formatTime, toLocalDate } from '../lib/time'
import { useNow } from '../lib/useNow'

/** One day of diapers: counts by kind, the list, and past diapers added. Fixing or deleting one happens in the timeline. */
export default function DiaperDay() {
  const { t } = useTranslation()
  const canEdit = (useMe().data?.role ?? 'viewer') !== 'viewer'
  const now = useNow()
  const [day, setDay] = useState(() => midnight(new Date()))
  const todayMs = midnight(new Date(now)).getTime()
  const today = useMemo(() => new Date(todayMs), [todayMs])
  const isToday = day.getTime() === todayMs
  const range = useMemo(() => ({ from: day, to: endOfDay(day) }), [day])
  const data = useDiaperRange(range.from, range.to).data
  // the tiles and the strips: the six days before this one, plus this one
  const weekFrom = useMemo(() => addDays(day, -6), [day])
  const week = useDiaperRange(weekFrom, range.to).data
  const strip = useStripRange(day, todayMs)
  const stripData = useDiaperRange(strip.from, strip.to).data
  const marked = useMemo(() => new Set((Array.isArray(stripData) ? stripData : []).map((d) => toLocalDate(new Date(d.at)))), [stripData])
  const qc = useQueryClient()
  const prefetch = (d: Date) => {
    void qc.prefetchQuery({ ...diaperRangeQuery(d, endOfDay(d)), staleTime: 60_000 })
    void qc.prefetchQuery({ ...diaperRangeQuery(addDays(d, -6), endOfDay(d)), staleTime: 60_000 })
  }
  const rows = (Array.isArray(data) ? data : [])
    .filter((d) => Date.parse(d.at) >= range.from.getTime() && Date.parse(d.at) <= range.to.getTime())
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const [form, setForm] = useState(false)

  return (
    <>
      <PageHeader title={t('diapers.title')} />
      <DayPager
        day={day}
        today={today}
        onDay={setDay}
        tone="diaper"
        prevLabel={t('diapers.prevDay')}
        nextLabel={t('diapers.nextDay')}
        marked={marked}
        onPrefetch={prefetch}
      >
      {Array.isArray(week) && (
        <>
          <DiaperTiles stats={diaperStats(week, day, now)} nowMs={now} isToday={isToday} />
          <Card className="space-y-2 p-4">
            <h2 className="text-sm font-semibold text-muted">{t('diapers.stripsTitle')}</h2>
            <DiaperStrips diapers={week} day={day} nowMs={now} />
          </Card>
        </>
      )}
      {canEdit && (
        <Button variant="soft" className="w-full" onClick={() => setForm(true)}>
          {t('diapers.addPast')}
        </Button>
      )}
      {data !== undefined && rows.length === 0 && <EmptyState icon={<Droplets size={28} />} title={t('diapers.none')} />}
      <ul aria-label={t('diapers.listLabel')} className="space-y-2">
        {rows.map((d) => (
          <li key={d.id}>
            <RowLink to={`/timeline?day=${toLocalDate(new Date(d.at))}&entry=diaper:${d.id}`} enabled={canEdit} label={t('timeline.edit')}>
              <Card tone="diaper" className="space-y-1 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{t(`diaperKinds.${d.kind}`)}</span>
                  <span className="text-sm font-semibold text-diaper-ink">{formatTime(d.at)}</span>
                </div>
                <p className="text-sm text-muted">{[t('home.by', { name: d.changed_by_name }), d.note].filter(Boolean).join(' · ')}</p>
              </Card>
            </RowLink>
          </li>
        ))}
      </ul>
      </DayPager>
      {form && <DiaperForm onClose={() => setForm(false)} />}
    </>
  )
}
