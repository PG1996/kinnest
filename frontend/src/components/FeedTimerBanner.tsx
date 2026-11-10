import { Timer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FeedTimerInfo } from '../api/hooks'
import { useNow } from '../lib/useNow'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Card } from './ui/card'

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/** A feed being timed (on this phone or another): what, who started it, and how long, with a way into the feed sheet. */
export default function FeedTimerBanner({ timer, onOpen }: { timer: FeedTimerInfo; onOpen: () => void }) {
  const { t } = useTranslation()
  const now = useNow(1000) // the seconds tick here, not for the whole Home page
  const end = timer.ended_at ? Date.parse(timer.ended_at) : now
  const seconds = Math.max(0, Math.floor((end - Date.parse(timer.started_at)) / 1000))
  return (
    <Card tone="feed" data-testid="feed-timer-banner" className="flex items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Timer size={26} aria-hidden="true" className="shrink-0 text-feed" />
        <div className="min-w-0 space-y-0.5">
          {/* live while it runs: a pulsing dot; once stopped it is a plain, calm badge */}
          <Badge tone={timer.ended_at ? 'plain' : 'feed'} dot pulse={!timer.ended_at}>
            {t(timer.ended_at ? 'home.timerHalted' : 'home.timerBanner')}
          </Badge>
          <p data-testid="feed-timer-elapsed" className="text-xl font-bold tabular-nums">{mmss(seconds)}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="feed" variant="outline" className="bg-surface">
              {t(`feedTypes.${timer.type}`)}
            </Badge>
            <span className="text-xs text-muted">{t('home.by', { name: timer.started_by_name })}</span>
          </div>
        </div>
      </div>
      <Button variant="soft" onClick={onOpen}>
        {t('home.timerOpen')}
      </Button>
    </Card>
  )
}
