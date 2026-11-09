import { ChevronLeft, ChevronRight, Moon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMe, useSleepRange, type Sleep } from '../api/hooks'
import PageHeader from '../components/PageHeader'
import SleepDonut from '../components/SleepDonut'
import SleepForm from '../components/SleepForm'
import { Button, IconButton } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { EmptyState } from '../components/ui/empty'
import { useDeleteSleep } from '../hooks/log'
import { sleepDay } from '../lib/sleepDay'
import { formatAgo, formatTime } from '../lib/time'
import { useNow } from '../lib/useNow'

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** One day of sleep: a 24-hour donut of asleep and awake, the sleeps that day, and past sleeps added or fixed. */
export default function SleepDay() {
  const { t } = useTranslation()
  const canEdit = (useMe().data?.role ?? 'viewer') !== 'viewer'
  const now = useNow()
  const [day, setDay] = useState(() => midnight(new Date()))
  const isToday = day.getTime() === midnight(new Date(now)).getTime()
  // a sleep that started the evening before still counts on this day, so fetch from a day earlier
  const range = useMemo(() => ({ from: new Date(day.getTime() - 86_400_000), to: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999) }), [day])
  const data = useSleepRange(range.from, range.to).data
  const sessions = Array.isArray(data) ? data : []
  const summary = sleepDay(sessions, day, new Date(now))
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
  const onDay = sessions
    .filter((s) => Date.parse(s.started_at) < dayEnd && (s.ended_at ? Date.parse(s.ended_at) : now) > day.getTime())
    .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))
  const [form, setForm] = useState<{ sleep?: Sleep } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const remove = useDeleteSleep()
  const shift = (days: number) => setDay(new Date(day.getFullYear(), day.getMonth(), day.getDate() + days))
  const label = isToday ? t('timeline.today') : day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <>
      <PageHeader title={t('sleep.dayTitle')} />
      <div className="flex items-center justify-between">
        <IconButton label={t('sleep.prevDay')} onClick={() => shift(-1)}>
          <ChevronLeft size={20} aria-hidden="true" />
        </IconButton>
        <span className="font-semibold">{label}</span>
        <IconButton label={t('sleep.nextDay')} onClick={() => shift(1)} disabled={isToday} className="disabled:opacity-40">
          <ChevronRight size={20} aria-hidden="true" />
        </IconButton>
      </div>
      <Card className="py-6">{data !== undefined && <SleepDonut day={day} data={summary} />}</Card>
      {canEdit && (
        <Button variant="soft" className="w-full" onClick={() => setForm({})}>
          {t('sleep.addPast')}
        </Button>
      )}
      {data !== undefined && onDay.length === 0 && <EmptyState icon={<Moon size={28} />} title={t('sleep.none')} />}
      <ul aria-label={t('sleep.listLabel')} className="space-y-2">
        {onDay.map((s) => (
          <li key={s.id}>
            <Card tone="sleep" className="space-y-1 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{t('sleep.range', { from: formatTime(s.started_at), to: s.ended_at ? formatTime(s.ended_at) : t('sleep.ongoing') })}</span>
                <span className="text-sm font-semibold text-sleep-ink">{formatAgo((s.ended_at ? Date.parse(s.ended_at) : now) - Date.parse(s.started_at))}</span>
              </div>
              <p className="text-sm text-muted">{[t('home.by', { name: s.started_by_name }), s.note].filter(Boolean).join(' · ')}</p>
              {canEdit && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {confirming === s.id ? (
                    <>
                      <Button variant="danger" onClick={() => remove.mutate(s.id, { onSuccess: () => setConfirming(null) })}>
                        {t('sleep.confirmDelete')}
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(null)}>
                        {t('sleep.keep')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="outline" onClick={() => setForm({ sleep: s })}>
                        {t('sleep.edit')}
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(s.id)}>
                        {t('sleep.delete')}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
      {form && <SleepForm key={form.sleep?.id ?? 'new'} sleep={form.sleep} onClose={() => setForm(null)} />}
    </>
  )
}
