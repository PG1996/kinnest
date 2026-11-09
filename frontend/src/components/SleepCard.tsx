import { Moon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useSleepRange, type SummarySleep } from '../api/hooks'
import { sleepDay } from '../lib/sleepDay'
import SleepDonut from './SleepDonut'
import { formatAgo, formatClock } from '../lib/time'
import { Card, Eyebrow } from './ui/card'

/** Shows whether she is asleep now, or how long the last sleep was. Starting and ending lives in the quick log. */
export default function SleepCard({ sleep, now }: { sleep: SummarySleep | undefined; now: number }) {
  const { t } = useTranslation()
  const open = sleep?.open ?? null
  const last = sleep?.last ?? null
  // today only, from the evening before so a sleep that crossed midnight is drawn
  const today = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate())
  const range = useMemo(() => ({ from: new Date(today.getTime() - 86_400_000), to: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999) }), [today.getTime()]) // eslint-disable-line react-hooks/exhaustive-deps
  const sessions = useSleepRange(range.from, range.to).data
  const donut = Array.isArray(sessions) ? sleepDay(sessions, today, new Date(now)) : null
  return (
    <Card tone="sleep" className="py-4">
      <Link to="/sleep" className="flex items-center gap-3">
      <Moon size={26} aria-hidden="true" className="shrink-0 text-sleep" />
      <div className="min-w-0 flex-1">
        <Eyebrow tone="sleep">{open ? t('sleep.asleepLabel') : t('sleep.title')}</Eyebrow>
        {open ? (
          <>
            <p className="text-base font-bold">
              {t('sleep.asleepSince', { time: formatClock(open.started_at), ago: formatAgo(now - Date.parse(open.started_at)) })}
            </p>
            <p className="text-sm text-muted">{t('home.by', { name: open.started_by_name })}</p>
          </>
        ) : last ? (
          <p className="text-base font-bold">
            {t('sleep.lastSleep', {
              duration: formatAgo((last.duration_min ?? 0) * 60_000),
              ago: formatAgo(now - Date.parse(last.ended_at ?? last.started_at)),
            })}
          </p>
        ) : (
          <p className="text-lg">{t('sleep.none')}</p>
        )}
      </div>
      {donut && <SleepDonut compact day={today} data={donut} />}
      </Link>
    </Card>
  )
}
