import { Timer } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useKid, useMe, useMembers, type Feed, type FeedType } from '../api/hooks'
import type { FeedInput } from '../hooks/log'
import { cn } from '../lib/cn'
import { formatAgo, toLocalInput } from '../lib/time'
import Sheet from './Sheet'
import { Button } from './ui/button'
import { Chip, ChipGroup } from './ui/chip'
import { Input } from './ui/field'
import { Stepper } from './ui/stepper'

const TYPES: FeedType[] = ['breast_left', 'breast_right', 'breast_both', 'expressed', 'formula']
const BOTTLE: FeedType[] = ['expressed', 'formula']
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

type Props = { last: Feed | null; saving: boolean; failed: boolean; onSave: (f: FeedInput) => void; onClose: () => void }

/** Full-screen feed logger: type, amount or duration (with an optional timer), who fed, when. */
export default function FeedSheet({ last, saving, failed, onSave, onClose }: Props) {
  const { t } = useTranslation()
  const me = useMe().data
  const rows = useMembers().data
  const people = (Array.isArray(rows) ? rows : []).filter((m) => !m.pending && m.user_id)
  const interval = useKid().data?.feed_interval_minutes
  const [type, setType] = useState<FeedType>(last?.type ?? 'breast_both')
  const [initialWhen] = useState(() => toLocalInput(new Date()))
  const [when, setWhen] = useState(initialWhen)
  const [duration, setDuration] = useState(last?.duration_min != null ? String(last.duration_min) : '')
  const [ml, setMl] = useState(last?.quantity_ml ?? 60)
  const [note, setNote] = useState('')
  const [by, setBy] = useState<string | null>(null)
  const [timerStart, setTimerStart] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const isBottle = BOTTLE.includes(type)
  const fedBy = by ?? me?.user.id ?? null

  useEffect(() => {
    if (timerStart === null) return
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - timerStart) / 1000)), 1000)
    return () => window.clearInterval(id)
  }, [timerStart])

  const stopTimer = () => {
    if (timerStart === null) return
    const seconds = Math.max(0, Math.floor((Date.now() - timerStart) / 1000))
    setDuration(String(Math.max(1, Math.round(seconds / 60))))
    setWhen(toLocalInput(new Date(timerStart)))
    setTimerStart(null)
    setElapsed(0)
  }

  const startMs = when === initialWhen ? Date.now() : new Date(when).getTime()
  const everyText = interval ? (interval % 60 === 0 ? `${interval / 60}h` : formatAgo(interval * 60_000)) : null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave({
      id: crypto.randomUUID(),
      type,
      // untouched time means "now", taken at the moment of saving
      started_at: when === initialWhen ? new Date().toISOString() : new Date(when).toISOString(),
      duration_min: !isBottle && duration ? Number(duration) : undefined,
      quantity_ml: isBottle ? ml : undefined,
      note: note || undefined,
      ...(fedBy && me && fedBy !== me.user.id ? { fed_by_user_id: fedBy } : {}),
    })
  }

  return (
    <Sheet
      variant="full"
      title={t('home.feed')}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {interval && <p className="text-center text-sm text-muted">{t('home.nextFeedHint', { time: clock(startMs + interval * 60_000), every: everyText })}</p>}
          {failed && <p className="text-center text-sm text-danger">{t('home.saveError')}</p>}
          <Button type="submit" form="feed-form" size="lg" className="w-full" disabled={saving}>
            {t('home.saveFeed')}
          </Button>
        </div>
      }
    >
      <form id="feed-form" onSubmit={submit} className="space-y-5">
        <fieldset className="m-0 border-0 p-0" aria-label={t('home.feedType')}>
          <div className="flex flex-wrap gap-2">
            {TYPES.map((k) => (
              <label
                key={k}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center rounded-full border-2 px-4 text-sm font-bold',
                  type === k ? 'border-primary bg-primary text-primary-ink' : 'border-line bg-surface',
                )}
              >
                <input type="radio" name="feed-type" className="sr-only" checked={type === k} onChange={() => setType(k)} />
                {t(`feedTypes.${k}`)}
              </label>
            ))}
          </div>
        </fieldset>

        {isBottle ? (
          <div className="space-y-2 rounded-card bg-surface p-4">
            <p className="text-sm font-extrabold text-muted">{t('home.amountLabel')}</p>
            <Stepper label={t('home.amount')} unit="ml" value={ml} step={10} min={0} max={300} onChange={setMl} />
          </div>
        ) : (
          <div className="space-y-3 rounded-card bg-surface p-4">
            <label htmlFor="feed-duration" className="block text-sm font-extrabold text-muted">
              {t('home.duration')}
            </label>
            <Input id="feed-duration" type="number" inputMode="numeric" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} />
            {timerStart === null ? (
              <Button type="button" variant="soft" className="w-full" onClick={() => setTimerStart(Date.now())}>
                <Timer size={20} aria-hidden="true" />
                {t('home.timerStart')}
              </Button>
            ) : (
              <Button type="button" variant="primary" className="w-full" onClick={stopTimer}>
                {t('home.timerStop')} · {mmss(elapsed)}
              </Button>
            )}
          </div>
        )}

        {people.length > 1 && (
          <ChipGroup label={t('home.fedBy')}>
            {people.map((m) => (
              <Chip key={m.user_id} pressed={fedBy === m.user_id} onClick={() => setBy(m.user_id)}>
                {m.name || m.email}
              </Chip>
            ))}
          </ChipGroup>
        )}

        <div className="space-y-2">
          <label htmlFor="feed-time" className="block text-sm font-extrabold text-muted">
            {t('home.time')}
          </label>
          <Input id="feed-time" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
        <div className="space-y-2">
          <label htmlFor="feed-note" className="block text-sm font-extrabold text-muted">
            {t('home.note')}
          </label>
          <Input id="feed-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </form>
    </Sheet>
  )
}
