import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { Summary } from '../api/hooks'
import { useCountUp } from '../lib/motion'
import { formatAgo, formatClock } from '../lib/time'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, Eyebrow } from './ui/card'
import { HalfGauge } from './ui/gauge'

const MIN = 60_000

export default function LastFeedCard({
  summary,
  now,
  canLog = false,
  feeding = false,
  onLogFeed,
}: {
  summary: Summary
  now: number
  canLog?: boolean
  /** a feed is being timed right now: the next feed is not late, it has begun */
  feeding?: boolean
  onLogFeed?: () => void
}) {
  const { t } = useTranslation()
  const f = summary.last_feed
  const startedMin = f ? Math.max(0, Math.floor((now - Date.parse(f.started_at)) / MIN)) : 0
  const shown = useCountUp(startedMin)
  if (!f) return <Card tone="feed" className="text-lg font-bold">{t('home.neverFed')}</Card>
  // what was given, as small pills; who gave it goes underneath
  const given = [t(`feedTypes.${f.type}`), f.quantity_ml != null ? `${f.quantity_ml} ml` : null, f.duration_min != null ? `${f.duration_min} min` : null].filter(Boolean) as string[]
  const due = summary.next_feed_due_at ? Date.parse(summary.next_feed_due_at) : null
  const overdue = !feeding && due !== null && due <= now
  const showNext = !feeding && due !== null && !overdue
  // the gauge runs from when the feed ended to when the next one is due
  const start = Date.parse(f.started_at) + (f.duration_min ?? 0) * 60_000
  const fraction = due !== null && due > start ? (now - start) / (due - start) : 0
  const leftMin = due !== null ? Math.max(0, Math.ceil((due - now) / MIN)) : null
  return (
    <Card tone="feed" className="space-y-3 shadow-[0_8px_24px_-12px_rgba(180,88,46,0.35)]">
      <Link to="/feeds" aria-label={t('feeds.title')} className="block space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow tone="feed">{overdue ? t('home.overdue') : t('home.lastFedLabel')}</Eyebrow>
        {feeding && !canLog && (
          <Badge tone="feed" dot pulse>
            {t('home.timerBanner')}
          </Badge>
        )}
        {showNext && (
          <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-bold text-feed-ink">
            {t('home.nextDue', { time: formatClock(summary.next_feed_due_at!) })}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[1.75rem] leading-none font-bold tabular-nums">
            {overdue ? t('home.dueAgo', { ago: formatAgo(now - due!) }) : t('home.agoShort', { ago: formatAgo(shown * MIN) })}
          </p>
          <div data-testid="feed-detail" className="space-y-1 pt-0.5">
            <div className="flex flex-wrap gap-1.5">
              {given.map((g) => (
                <span key={g} className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-bold text-feed-ink">
                  {g}
                </span>
              ))}
            </div>
            <p className="text-xs text-muted">{t('home.by', { name: f.fed_by_name })}</p>
          </div>
          {overdue && <p className="text-sm text-muted">{t('home.lastFedAgo', { ago: formatAgo(startedMin * MIN) })}</p>}
        </div>
        {showNext && leftMin !== null && (
          <HalfGauge fraction={fraction} tone="feed" label={t('home.gaugeLabel', { percent: Math.round(Math.min(1, fraction) * 100), left: formatAgo(leftMin * MIN) })}>
            <span className="text-base font-bold tabular-nums">{formatAgo(leftMin * MIN)}</span>
            <span className="text-xs font-bold text-muted">{t('home.toNextFeed')}</span>
          </HalfGauge>
        )}
      </div>
      </Link>
      {overdue && canLog && (
        <Button size="lg" className="w-full bg-feed-ink text-surface" onClick={onLogFeed}>
          {t('home.logFeedNow')}
        </Button>
      )}
    </Card>
  )
}
