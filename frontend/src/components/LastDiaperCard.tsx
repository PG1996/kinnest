import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { Summary } from '../api/hooks'
import { formatAgo } from '../lib/time'
import { Card, Eyebrow } from './ui/card'
import { Sparkline } from './ui/sparkline'

export default function LastDiaperCard({ summary, now, wetPerDay }: { summary: Summary; now: number; wetPerDay?: number[] }) {
  const { t } = useTranslation()
  const d = summary.last_diaper
  if (!d) return <Card tone="diaper">{t('home.noDiaper')}</Card>
  const c = summary.diapers_today
  // the average of finished days that have data: not today (still going) and not days before logging began
  const finished = (wetPerDay ?? []).slice(0, -1).filter((n) => n > 0)
  const avg = finished.length ? finished.reduce((a, b) => a + b, 0) / finished.length : null
  return (
    <Card tone="diaper" data-testid="diaper-card" className="py-4">
      <Link to="/diapers" className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Eyebrow tone="diaper">{t('home.lastDiaperLabel')}</Eyebrow>
          <p className="text-xl font-bold">{t('home.agoShort', { ago: formatAgo(now - Date.parse(d.at)) })}</p>
          <span className="inline-block rounded-full bg-surface px-2.5 py-0.5 text-xs font-bold text-diaper-ink">{t(`diaperKinds.${d.kind}`)}</span>
          <p className="text-xs text-muted">{t('home.by', { name: d.changed_by_name })}</p>
          <div data-testid="diaper-today" className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs font-semibold text-muted">{t('home.todayLabel')}</span>
            {([['todayWet', c.wet], ['todayDirty', c.dirty], ['todayBoth', c.both]] as const).map(([key, n]) => (
              <span key={key} className="rounded-full bg-surface/70 px-2 py-0.5 text-xs font-semibold tabular-nums">
                {t(`home.${key}`, { n })}
              </span>
            ))}
          </div>
        </div>
        {wetPerDay && wetPerDay.length > 1 && (
          <div className="flex flex-col items-end gap-1">
            <Sparkline values={wetPerDay} label={t('home.sparkLabel', { values: wetPerDay.join(', ') })} className="text-diaper" />
            {avg !== null && (
              <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-bold text-diaper-ink">
                {t('home.sparkAvg', { avg: avg.toFixed(1) })}
              </span>
            )}
          </div>
        )}
      </Link>
    </Card>
  )
}
