import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api/client'
import type { SummarySleep } from '../api/hooks'
import type { ToastData } from '../components/Toast'
import { useEndSleep, useStartSleep } from './log'

/** Start or end a sleep from anywhere on Home; explains a clash with another phone instead of showing an error. */
export function useSleepActions(sleep: SummarySleep | undefined, onToast: (t: ToastData) => void) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const start = useStartSleep()
  const end = useEndSleep()
  const open = sleep?.open ?? null

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

  return {
    open,
    pending: start.isPending || end.isPending,
    toggle: () =>
      open
        ? end.mutate({ id: open.id, ended_at: new Date().toISOString() }, { onSuccess: queuedNotice, onError: failed })
        : start.mutate({ id: crypto.randomUUID(), started_at: new Date().toISOString() }, { onSuccess: queuedNotice, onError: failed }),
  }
}
