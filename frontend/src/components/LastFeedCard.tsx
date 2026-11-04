import { useTranslation } from 'react-i18next'
import type { Summary } from '../api/hooks'
import { formatAgo, formatClock } from '../lib/time'
import { Card } from './ui/card'

export default function LastFeedCard({ summary, now }: { summary: Summary; now: number }) {
  const { t } = useTranslation()
  const f = summary.last_feed
  if (!f) return <Card className="text-lg">{t('home.neverFed')}</Card>
  const detail = [
    t('home.by', { name: f.fed_by_name }),
    t(`feedTypes.${f.type}`),
    f.quantity_ml != null ? `${f.quantity_ml} ml` : null,
    f.duration_min != null ? `${f.duration_min} min` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const due = summary.next_feed_due_at ? new Date(summary.next_feed_due_at).getTime() : null
  const overdue = due !== null && due <= now
  return (
    <Card className="space-y-1">
      <p className="text-2xl font-semibold">{t('home.lastFed', { ago: formatAgo(now - new Date(f.started_at).getTime()) })}</p>
      <p className="text-muted">{detail}</p>
      {due !== null && (
        <p className={overdue ? 'font-medium text-danger' : 'text-ink'}>
          {overdue
            ? t('home.overdue', { ago: formatAgo(now - due) })
            : t('home.nextDue', { time: formatClock(summary.next_feed_due_at!) })}
        </p>
      )}
    </Card>
  )
}
