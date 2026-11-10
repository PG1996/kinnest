import { ChevronRight, Pause, Play, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FeedTimerInfo } from '../api/hooks'
import { useFeedTimerActions } from '../hooks/log'
import { feedingSeconds, isPaused } from '../lib/feedTimer'
import { useNow } from '../lib/useNow'
import { Badge } from './ui/badge'
import { IconButton } from './ui/button'
import { Card } from './ui/card'

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/**
 * A feed being timed (on this phone or another): a live badge, the clock, and three icons: pause or resume, stop, open.
 * Stop ends the timer and opens the feed form, which asks about breaks once and saves.
 */
export default function FeedTimerBanner({ timer, onOpen }: { timer: FeedTimerInfo; onOpen: () => void }) {
  const { t } = useTranslation()
  const now = useNow(1000) // the seconds tick here, not for the whole Home page
  const actions = useFeedTimerActions()
  const stopped = !!timer.ended_at
  const paused = isPaused(timer)
  const seconds = feedingSeconds(timer, now)
  const icon = 'size-10 border border-line'
  return (
    <Card tone="feed" data-testid="feed-timer-banner" className="space-y-2.5 py-3">
      <div className="flex items-center justify-between gap-3">
        {/* live while it runs: a pulsing dot; paused or stopped it is a calm badge */}
        <Badge tone={stopped || paused ? 'plain' : 'feed'} dot pulse={!stopped && !paused}>
          {t(stopped ? 'home.timerHalted' : paused ? 'home.timerPaused' : 'home.timerBanner')}
        </Badge>
        <div className="flex items-center gap-2">
          {stopped ? (
            <IconButton label={t('home.timerResume')} className={icon} onClick={() => actions.change.mutate({ ended_at: null })}>
              <Play size={18} aria-hidden="true" />
            </IconButton>
          ) : (
            <>
              <IconButton
                label={t(paused ? 'home.timerResume' : 'home.timerPause')}
                className={icon}
                onClick={() => actions.change.mutate({ paused: !paused })}
              >
                {paused ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
              </IconButton>
              <IconButton
                label={t('home.timerStop')}
                className={icon}
                onClick={() => actions.change.mutate({ ended_at: new Date().toISOString() }, { onSuccess: onOpen })}
              >
                <Square size={16} aria-hidden="true" />
              </IconButton>
            </>
          )}
          <IconButton label={t('home.timerOpen')} className={icon} onClick={onOpen}>
            <ChevronRight size={18} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p data-testid="feed-timer-elapsed" className="text-[1.75rem] leading-none font-bold tabular-nums">{mmss(seconds)}</p>
        <Badge tone="feed" variant="outline" className="bg-surface">
          {t(`feedTypes.${timer.type}`)}
        </Badge>
        <span className="text-xs text-muted">{t('home.by', { name: timer.started_by_name })}</span>
      </div>
    </Card>
  )
}
