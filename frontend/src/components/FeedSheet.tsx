import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Feed, FeedType } from '../api/hooks'
import type { FeedInput } from '../hooks/log'
import { toLocalInput } from '../lib/time'
import Sheet from './Sheet'
import { Button } from './ui/button'
import { Input } from './ui/field'
import { cn } from '../lib/cn'

const TYPES: FeedType[] = ['breast_left', 'breast_right', 'breast_both', 'expressed', 'formula']
const BOTTLE: FeedType[] = ['expressed', 'formula']

type Props = { last: Feed | null; saving: boolean; failed: boolean; onSave: (f: FeedInput) => void; onClose: () => void }

export default function FeedSheet({ last, saving, failed, onSave, onClose }: Props) {
  const { t } = useTranslation()
  const [type, setType] = useState<FeedType>(last?.type ?? 'breast_both')
  const [initialWhen] = useState(() => toLocalInput(new Date()))
  const [when, setWhen] = useState(initialWhen)
  const [duration, setDuration] = useState(last?.duration_min != null ? String(last.duration_min) : '')
  const [ml, setMl] = useState(last?.quantity_ml != null ? String(last.quantity_ml) : '')
  const [note, setNote] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave({
      id: crypto.randomUUID(),
      type,
      // untouched time means "now", taken at the moment of saving
      started_at: when === initialWhen ? new Date().toISOString() : new Date(when).toISOString(),
      duration_min: duration ? Number(duration) : undefined,
      quantity_ml: BOTTLE.includes(type) && ml ? Number(ml) : undefined,
      note: note || undefined,
    })
  }

  return (
    <Sheet title={t('home.feed')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <fieldset className="flex flex-wrap gap-2" aria-label={t('home.feedType')}>
          {TYPES.map((k) => (
            <label
              key={k}
              className={cn(
                'flex min-h-12 cursor-pointer items-center rounded-full border border-line px-4',
                type === k && 'border-primary bg-primary text-primary-ink',
              )}
            >
              <input type="radio" name="feed-type" className="sr-only" checked={type === k} onChange={() => setType(k)} />
              {t(`feedTypes.${k}`)}
            </label>
          ))}
        </fieldset>
        {BOTTLE.includes(type) && (
          <>
            <label htmlFor="feed-ml" className="block text-sm text-muted">
              {t('home.amount')}
            </label>
            <Input id="feed-ml" type="number" inputMode="numeric" min={0} value={ml} onChange={(e) => setMl(e.target.value)} />
          </>
        )}
        <label htmlFor="feed-duration" className="block text-sm text-muted">
          {t('home.duration')}
        </label>
        <Input id="feed-duration" type="number" inputMode="numeric" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} />
        <label htmlFor="feed-time" className="block text-sm text-muted">
          {t('home.time')}
        </label>
        <Input id="feed-time" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <label htmlFor="feed-note" className="block text-sm text-muted">
          {t('home.note')}
        </label>
        <Input id="feed-note" value={note} onChange={(e) => setNote(e.target.value)} />
        {failed && <p className="text-sm text-danger">{t('home.saveError')}</p>}
        <Button type="submit" className="w-full" disabled={saving}>
          {t('home.saveFeed')}
        </Button>
      </form>
    </Sheet>
  )
}
