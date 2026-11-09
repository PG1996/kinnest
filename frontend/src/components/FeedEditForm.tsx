import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Feed, FeedType } from '../api/hooks'
import { useLogFeed, useUpdateFeed } from '../hooks/log'
import { toLocalInput } from '../lib/time'
import FedBy from './FedBy'
import Sheet from './Sheet'
import { Button } from './ui/button'
import { Chip, ChipGroup } from './ui/chip'
import { Input } from './ui/field'
import { Stepper } from './ui/stepper'

const TYPES: FeedType[] = ['breast_left', 'breast_right', 'breast_both', 'expressed', 'formula']
const BOTTLE: FeedType[] = ['expressed', 'formula']

/** Add a past feed, or fix one: type, amount or duration, time and note. */
export default function FeedEditForm({ feed, onClose }: { feed?: Feed; onClose: () => void }) {
  const { t } = useTranslation()
  const add = useLogFeed()
  const update = useUpdateFeed()
  // the time input shows minutes only: an untouched one keeps the exact stored time
  const [initialWhen] = useState(() => toLocalInput(new Date(feed?.started_at ?? Date.now())))
  const [when, setWhen] = useState(initialWhen)
  const [type, setType] = useState<FeedType>(feed?.type ?? 'formula')
  const [ml, setMl] = useState(feed?.quantity_ml ?? 60)
  const [duration, setDuration] = useState(feed?.duration_min != null ? String(feed.duration_min) : '')
  const [note, setNote] = useState(feed?.note ?? '')
  const [by, setBy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const bottle = BOTTLE.includes(type)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const whenChanged = !feed || when !== initialWhen
    const at = whenChanged ? new Date(when) : new Date(feed!.started_at)
    if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 2 * 60_000) return setError(t('diapers.form.future'))
    const minutes = duration.trim() === '' ? null : Number(duration)
    if (!bottle && minutes !== null && !(Number.isInteger(minutes) && minutes >= 0 && minutes <= 600)) return setError(t('timeline.saveError'))
    setError('')
    const done = { onSuccess: onClose, onError: () => setError(t('timeline.saveError')) }
    if (feed) {
      const changes = {
        ...(type !== feed.type ? { type } : {}),
        ...(whenChanged ? { started_at: at.toISOString() } : {}),
        ...(bottle && (ml !== feed.quantity_ml || type !== feed.type) ? { quantity_ml: ml } : {}),
        ...(bottle && feed.duration_min != null ? { duration_min: null } : {}),
        ...(!bottle && (minutes !== feed.duration_min || type !== feed.type) ? { duration_min: minutes } : {}),
        ...(!bottle && feed.quantity_ml != null ? { quantity_ml: null } : {}),
        ...(note !== (feed.note ?? '') ? { note } : {}),
        ...(by && !type.startsWith('breast') ? { fed_by_user_id: by } : {}),
      }
      if (Object.keys(changes).length === 0) return onClose()
      update.mutate({ id: feed.id, ...changes }, done)
    } else {
      add.mutate(
        { id: crypto.randomUUID(), type, started_at: at.toISOString(), ...(bottle ? { quantity_ml: ml } : minutes !== null ? { duration_min: minutes } : {}), ...(note ? { note } : {}), ...(by && !type.startsWith('breast') ? { fed_by_user_id: by } : {}) },
        done,
      )
    }
  }

  return (
    <Sheet title={t(feed ? 'timeline.feedEditTitle' : 'timeline.feedAddTitle')} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-3">
        <ChipGroup label={t('home.feedType')}>
          {TYPES.map((k) => (
            <Chip key={k} pressed={type === k} onClick={() => setType(k)}>
              {t(`feedTypes.${k}`)}
            </Chip>
          ))}
        </ChipGroup>
        {bottle ? (
          <Stepper label={t('home.amount')} unit="ml" value={ml} step={10} min={0} max={300} onChange={setMl} />
        ) : (
          <div className="space-y-1">
            <label htmlFor="feed-edit-duration" className="block text-xs font-medium text-muted">
              {t('home.duration')}
            </label>
            <Input id="feed-edit-duration" type="number" inputMode="numeric" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} />
          </div>
        )}
        <FedBy type={type} value={by ?? feed?.fed_by_user_id ?? null} onChange={setBy} />
        <div className="space-y-1">
          <label htmlFor="feed-edit-when" className="block text-xs font-medium text-muted">
            {t('home.time')}
          </label>
          <Input id="feed-edit-when" type="datetime-local" value={when} max={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label htmlFor="feed-edit-note" className="block text-xs font-medium text-muted">
            {t('home.note')}
          </label>
          <Input id="feed-edit-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full" disabled={add.isPending || update.isPending}>
          {t('timeline.save')}
        </Button>
      </form>
    </Sheet>
  )
}
