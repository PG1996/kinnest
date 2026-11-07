import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api/client'
import type { SummarySleep } from '../api/hooks'
import { useEndSleep, useStartSleep } from '../hooks/log'
import { formatAgo, formatClock } from '../lib/time'
import type { ToastData } from './Toast'
import { Button } from './ui/button'
import { Card } from './ui/card'

type Props = { sleep: SummarySleep | undefined; now: number; canLog: boolean; onToast: (t: ToastData) => void }

export default function SleepCard({ sleep, now, canLog, onToast }: Props) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const start = useStartSleep()
  const end = useEndSleep()
  const open = sleep?.open ?? null
  const last = sleep?.last ?? null

  const failed = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409) {
      qc.invalidateQueries({ queryKey: ['summary'] }) // another phone got there first: show what is true now
      const who = (e.body as { open?: { started_by_name?: string } } | undefined)?.open?.started_by_name
      onToast({ message: who ? t('sleep.alreadyAsleep', { name: who }) : t('sleep.alreadyEnded') })
    } else {
      onToast({ message: t('home.saveError') })
    }
  }
  const queuedNotice = (r: { queued?: boolean }) => r.queued && onToast({ message: t('home.queued') })

  const onStart = () =>
    start.mutate({ id: crypto.randomUUID(), started_at: new Date().toISOString() }, { onSuccess: queuedNotice, onError: failed })
  const onEnd = () =>
    open && end.mutate({ id: open.id, ended_at: new Date().toISOString() }, { onSuccess: queuedNotice, onError: failed })

  return (
    <Card className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        {open ? (
          <>
            <p className="text-lg font-medium">
              {t('sleep.asleepSince', { time: formatClock(open.started_at), ago: formatAgo(now - Date.parse(open.started_at)) })}
            </p>
            <p className="text-sm text-muted">{t('home.by', { name: open.started_by_name })}</p>
          </>
        ) : last ? (
          <p className="text-lg font-medium">
            {t('sleep.lastSleep', {
              duration: formatAgo((last.duration_min ?? 0) * 60_000),
              ago: formatAgo(now - Date.parse(last.ended_at ?? last.started_at)),
            })}
          </p>
        ) : (
          <p className="text-lg">{t('sleep.none')}</p>
        )}
      </div>
      {canLog &&
        (open ? (
          <Button onClick={onEnd} disabled={end.isPending}>
            {t('sleep.end')}
          </Button>
        ) : (
          <Button variant="soft" onClick={onStart} disabled={start.isPending}>
            {t('sleep.start')}
          </Button>
        ))}
    </Card>
  )
}
