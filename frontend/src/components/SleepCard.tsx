import { Moon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SummarySleep } from '../api/hooks'
import { formatAgo, formatClock } from '../lib/time'
import { Card, Eyebrow } from './ui/card'

/** Shows whether she is asleep now, or how long the last sleep was. Starting and ending lives in the quick log. */
export default function SleepCard({ sleep, now }: { sleep: SummarySleep | undefined; now: number }) {
  const { t } = useTranslation()
  const open = sleep?.open ?? null
  const last = sleep?.last ?? null
  return (
    <Card tone="sleep" className="flex items-center gap-3 py-4">
      <Moon size={26} aria-hidden="true" className="shrink-0 text-sleep" />
      <div className="min-w-0">
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
    </Card>
  )
}
