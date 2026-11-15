import { Pause, Play, Timer } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useKid, useMe, useSummary, type Feed, type FeedType } from '../api/hooks'
import { useFeedTimerActions, type FeedInput } from '../hooks/log'
import { feedingSeconds, isPaused, recordedBreakMinutes, wallMinutes } from '../lib/feedTimer'
import { formatAgo, formatTime, toLocalInput } from '../lib/time'
import { useNow } from '../lib/useNow'
import Sheet from './Sheet'
import { Button } from './ui/button'
import FedBy from './FedBy'
import FeedTypePicker from './FeedTypePicker'
import { Chip, ChipGroup } from './ui/chip'
import { DateTimeField } from './ui/datetime'
import { Input } from './ui/field'
import { Stepper } from './ui/stepper'

const BOTTLE: FeedType[] = ['expressed', 'formula']
const clock = formatTime
const BREAKS = [5, 10, 15, 20]
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

type Props = { last: Feed | null; saving: boolean; failed: boolean; onSave: (f: FeedInput) => void; onClose: () => void }

/** Full-screen feed logger: type, amount or duration (with an optional timer), who fed, when. */
export default function FeedSheet({ last, saving, failed, onSave, onClose }: Props) {
  const { t } = useTranslation()
  const me = useMe().data
  const interval = useKid().data?.feed_interval_minutes
  const [type, setType] = useState<FeedType>(last?.type ?? 'breast_both')
  const [initialWhen] = useState(() => toLocalInput(new Date()))
  const [when, setWhen] = useState(initialWhen)
  const [duration, setDuration] = useState(last?.duration_min != null ? String(last.duration_min) : '')
  const [ml, setMl] = useState(last?.quantity_ml ?? 60)
  const [note, setNote] = useState('')
  const [by, setBy] = useState<string | null>(null)
  // the timer lives on the server: every phone, and a refresh, sees the same one
  const timer = useSummary().data?.feed_timer ?? null
  const actions = useFeedTimerActions()
  const now = useNow(1000)
  const paused = !!timer && isPaused(timer)
  const stopped = !!timer?.ended_at
  const elapsedS = timer ? feedingSeconds(timer, now) : 0
  // breaks: asked once the feed is stopped (None, 5, 10, 15, 20 minutes or any other); breaks recorded with Pause are already chosen
  const recorded = timer ? recordedBreakMinutes(timer) : 0
  const wall = timer ? wallMinutes(timer) : 0
  const [breakChoice, setBreakChoice] = useState<number | 'other' | null>(null)
  const [otherBreak, setOtherBreak] = useState('')
  const selected: number | 'other' = breakChoice ?? (recorded === 0 ? 0 : BREAKS.includes(recorded) ? recorded : 'other')
  const otherValue = otherBreak !== '' ? otherBreak : breakChoice === null && selected === 'other' ? String(recorded) : ''
  const askedBreak = Math.min(wall, selected === 'other' ? Math.max(0, Number(otherValue) || 0) : selected)
  const breakMin = stopped ? askedBreak : recorded
  // the feeding itself: the whole time on the clock less the breaks, or the running clock (which already leaves breaks out)
  const timerMinutes = stopped ? Math.max(0, wall - askedBreak) : Math.max(1, Math.round(elapsedS / 60))
  // a timer sets the type and the time it was started with, once; after that the chips and the Time field drive them.
  // Discarding the timer then keeps that start, so a duration typed instead is logged from when the feed began.
  const [syncedTimer, setSyncedTimer] = useState<string | null>(null)
  if (timer && syncedTimer !== timer.id) {
    setSyncedTimer(timer.id)
    setType(timer.type)
    setWhen(toLocalInput(new Date(timer.started_at)))
  }
  const isBottle = BOTTLE.includes(type)
  const fedBy = by ?? me?.user.id ?? null
  const pickType = (next: FeedType) => {
    setType(next)
    if (timer && next !== timer.type) actions.change.mutate({ type: next })
  }

  const startMs = timer ? Date.parse(timer.started_at) : when === initialWhen ? Date.now() : new Date(when).getTime()
  // the next feed is due one interval after this one ends (bottles have no duration)
  const feedMs = timer && !isBottle ? (timerMinutes + breakMin) * 60_000 : !isBottle && duration && Number(duration) > 0 ? Number(duration) * 60_000 : 0
  const everyText = interval ? (interval % 60 === 0 ? `${interval / 60}h` : formatAgo(interval * 60_000)) : null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    // Save while the timer still runs counts as Stop: the feed started when the timer did and lasted until now
    onSave({
      id: crypto.randomUUID(),
      type,
      // untouched time means "now", taken at the moment of saving
      started_at: timer ? timer.started_at : when === initialWhen ? new Date().toISOString() : new Date(when).toISOString(),
      duration_min: isBottle ? undefined : timer ? timerMinutes : duration ? Number(duration) : undefined,
      ...(timer && !isBottle ? { break_min: breakMin } : {}),
      ...(timer ? { timer_id: timer.id } : {}),
      quantity_ml: isBottle ? ml : undefined,
      note: note || undefined,
      ...(!isBottle && type.startsWith('breast') ? {} : fedBy && me && fedBy !== me.user.id ? { fed_by_user_id: fedBy } : {}),
    })
  }

  return (
    <Sheet tone="feed"
      variant="full"
      title={t('home.feed')}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {interval && <p className="text-center text-sm text-muted">{t('home.nextFeedHint', { time: clock(startMs + feedMs + interval * 60_000), every: everyText })}</p>}
          {failed && <p className="text-center text-sm text-danger">{t('home.saveError')}</p>}
          <Button type="submit" form="feed-form" size="lg" className="w-full" disabled={saving}>
            {t('home.saveFeed')}
          </Button>
        </div>
      }
    >
      <form id="feed-form" onSubmit={submit} className="space-y-5">
        <FeedTypePicker value={type} onChange={pickType} />

        {isBottle ? (
          <div className="space-y-2 rounded-card bg-surface p-4">
            <p className="text-[13px] font-semibold text-muted">{t('home.amountLabel')}</p>
            <Stepper label={t('home.amount')} unit="ml" value={ml} step={10} min={0} max={300} onChange={setMl} />
          </div>
        ) : (
          <div className="space-y-3 rounded-card bg-surface p-4">
            <label htmlFor="feed-duration" className="block text-[13px] font-semibold text-muted">
              {t('home.duration')}
            </label>
            <Input
              id="feed-duration"
              type="number"
              inputMode="numeric"
              min={0}
              value={timer ? timerMinutes : duration}
              disabled={!!timer}
              onChange={(e) => setDuration(e.target.value)}
            />
            {!timer ? (
              <Button
                type="button"
                variant="soft"
                className="w-full"
                disabled={actions.start.isPending}
                onClick={() => actions.start.mutate({ id: crypto.randomUUID(), type, started_at: new Date().toISOString() })}
              >
                <Timer size={20} aria-hidden="true" />
                {t('home.timerStart')}
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {stopped ? (
                    <Button type="button" variant="soft" className="col-span-2" onClick={() => actions.change.mutate({ ended_at: null })}>
                      {t('home.timerResume')} · {mmss(elapsedS)}
                    </Button>
                  ) : paused ? (
                    <>
                      <Button type="button" variant="primary" onClick={() => actions.change.mutate({ paused: false })}>
                        <Play size={18} aria-hidden="true" />
                        {t('home.timerResume')} · {mmss(elapsedS)}
                      </Button>
                      <Button type="button" variant="soft" onClick={() => actions.change.mutate({ ended_at: new Date().toISOString() })}>
                        {t('home.timerStop')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button type="button" variant="primary" onClick={() => actions.change.mutate({ ended_at: new Date().toISOString() })}>
                        {t('home.timerStop')} · {mmss(elapsedS)}
                      </Button>
                      <Button type="button" variant="soft" onClick={() => actions.change.mutate({ paused: true })}>
                        <Pause size={18} aria-hidden="true" />
                        {t('home.timerPause')}
                      </Button>
                    </>
                  )}
                </div>
                {stopped && (
                  <div className="space-y-3 border-t border-line pt-3">
                    <p className="text-sm font-semibold">{t('feed.onClock', { n: wall })}</p>
                    <ChipGroup label={t('feed.breaksTitle')}>
                      <Chip pressed={selected === 0} onClick={() => setBreakChoice(0)}>
                        {t('feed.breaksNone')}
                      </Chip>
                      {BREAKS.map((n) => (
                        <Chip key={n} pressed={selected === n} disabled={n >= wall} className="disabled:opacity-40" onClick={() => setBreakChoice(n)}>
                          {t('feed.breaksMin', { n })}
                        </Chip>
                      ))}
                      <Chip pressed={selected === 'other'} onClick={() => setBreakChoice('other')}>
                        {t('feed.breaksOther')}
                      </Chip>
                    </ChipGroup>
                    {selected === 'other' && (
                      <div className="space-y-1">
                        <label htmlFor="feed-break-other" className="block text-[13px] font-semibold text-muted">
                          {t('feed.breaksOtherLabel')}
                        </label>
                        <Input id="feed-break-other" type="number" inputMode="numeric" min={0} max={wall} value={otherValue} onChange={(e) => setOtherBreak(e.target.value)} />
                      </div>
                    )}
                    {askedBreak > 0 && <p className="text-sm font-semibold text-muted">{t('feed.feedingTime', { n: timerMinutes })}</p>}
                  </div>
                )}
                <Button type="button" variant="ghost" onClick={() => actions.discard.mutate()}>
                  {t('home.timerDiscard')}
                </Button>
              </div>
            )}
            {actions.start.isError && <p className="text-sm text-danger">{t('home.timerFailed')}</p>}
          </div>
        )}

        <FedBy type={type} value={by} onChange={setBy} />

        <div className="space-y-2">
          <label htmlFor="feed-time" className="block text-[13px] font-semibold text-muted">
            {t('home.time')}
          </label>
          <DateTimeField id="feed-time" label={t('home.time')} value={when} onChange={setWhen} />
        </div>
        <div className="space-y-2">
          <label htmlFor="feed-note" className="block text-[13px] font-semibold text-muted">
            {t('home.note')}
          </label>
          <Input id="feed-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </form>
    </Sheet>
  )
}
