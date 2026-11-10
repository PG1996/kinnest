import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api/client'
import type { Sleep } from '../api/hooks'
import { useAddPastSleep, useUpdateSleep } from '../hooks/log'
import { formatTime, toLocalInput } from '../lib/time'
import Sheet from './Sheet'
import { Button } from './ui/button'
import { Input } from './ui/field'

const MAX_MS = 24 * 3_600_000

/** Add a past sleep (start and end), or edit one. An ongoing sleep may keep its end empty. */
export default function SleepForm({ sleep, onClose }: { sleep?: Sleep; onClose: () => void }) {
  const { t } = useTranslation()
  const add = useAddPastSleep()
  const update = useUpdateSleep()
  // the inputs show minutes only: an untouched field keeps the exact stored time instead of a rounded one
  const [initialStart] = useState(() => (sleep ? toLocalInput(new Date(sleep.started_at)) : ''))
  const [initialEnd] = useState(() => (sleep?.ended_at ? toLocalInput(new Date(sleep.ended_at)) : ''))
  const [start, setStart] = useState(initialStart)
  const [end, setEnd] = useState(initialEnd)
  const [note, setNote] = useState(sleep?.note ?? '')
  const [error, setError] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const startChanged = !sleep || start !== initialStart
    const endChanged = !sleep || end !== initialEnd
    const a = startChanged ? new Date(start) : new Date(sleep!.started_at)
    // an empty "Woke up" means still asleep (when editing); a new past sleep needs both times
    const b = end ? (endChanged ? new Date(end) : new Date(sleep!.ended_at!)) : null
    const soon = Date.now() + 2 * 60_000
    if (Number.isNaN(a.getTime()) || (b && Number.isNaN(b.getTime())) || (!b && !sleep)) return setError(t('sleep.form.endBeforeStart'))
    if (a.getTime() > soon || (b && b.getTime() > soon)) return setError(t('sleep.form.future'))
    if (b && b <= a) return setError(t('sleep.form.endBeforeStart'))
    if (b && b.getTime() - a.getTime() > MAX_MS) return setError(t('sleep.form.tooLong'))
    setError('')
    const failed = (err: unknown) => {
      const body = err instanceof ApiError && err.status === 409 ? (err.body as { overlaps?: Sleep; open?: Sleep } | undefined) : undefined
      const other = body?.overlaps
      if (body?.open) return setError(t('sleep.alreadyAsleep', { name: body.open.started_by_name }))
      setError(
        other
          ? t('sleep.overlaps', { range: t('sleep.range', { from: formatTime(other.started_at), to: other.ended_at ? formatTime(other.ended_at) : t('sleep.ongoing') }) })
          : t('sleep.saveError'),
      )
    }
    if (sleep) {
      const changes = {
        ...(startChanged ? { started_at: a.toISOString() } : {}),
        ...(endChanged ? { ended_at: b ? b.toISOString() : null } : {}),
        ...(note !== (sleep.note ?? '') ? { note } : {}),
      }
      if (Object.keys(changes).length === 0) return onClose()
      update.mutate(
        { id: sleep.id, ...changes },
        { onSuccess: onClose, onError: failed },
      )
    } else {
      add.mutate({ id: crypto.randomUUID(), started_at: a.toISOString(), ended_at: b!.toISOString(), note }, { onSuccess: onClose, onError: failed })
    }
  }

  return (
    <Sheet tone="sleep" title={t(sleep ? 'sleep.editTitle' : 'sleep.addTitle')} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="sleep-start" className="block text-[13px] font-semibold text-muted">
            {t('sleep.form.start')}
          </label>
          <Input id="sleep-start" type="datetime-local" value={start} max={toLocalInput(new Date())} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label htmlFor="sleep-end" className="block text-[13px] font-semibold text-muted">
            {t('sleep.form.end')}
          </label>
          <Input id="sleep-end" type="datetime-local" value={end} max={toLocalInput(new Date())} onChange={(e) => setEnd(e.target.value)} />
          {sleep && <p className="text-xs text-muted">{t('sleep.form.endHint')}</p>}
        </div>
        <div className="space-y-1">
          <label htmlFor="sleep-note" className="block text-[13px] font-semibold text-muted">
            {t('sleep.form.note')}
          </label>
          <Input id="sleep-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={add.isPending || update.isPending}>
          {t('sleep.form.save')}
        </Button>
      </form>
    </Sheet>
  )
}
