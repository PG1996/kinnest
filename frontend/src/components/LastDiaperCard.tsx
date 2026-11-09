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
  const avg = wetPerDay && wetPerDay.length ? wetPerDay.reduce((a, b) => a + b, 0) / wetPerDay.length : null
  return (
    <Card tone="diaper" className="py-4">
      <Link to="/patterns" className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Eyebrow tone="diaper">{t('home.lastDiaperLabel')}</Eyebrow>
          <p className="text-2xl font-extrabold">{t('home.agoShort', { ago: formatAgo(now - Date.parse(d.at)) })}</p>
          <p className="text-sm text-muted">
            {t('home.by', { name: d.changed_by_name })} · {t(`diaperKinds.${d.kind}`)}
          </p>
          <p className="text-sm text-muted">{t('home.todayDiapers', { wet: c.wet, dirty: c.dirty, both: c.both })}</p>
        </div>
        {wetPerDay && wetPerDay.length > 1 && avg !== null && (
          <div className="flex flex-col items-end gap-1">
            <Sparkline values={wetPerDay} label={t('home.sparkLabel', { values: wetPerDay.join(', ') })} className="text-diaper" />
            <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-extrabold text-diaper-ink">
              {t('home.sparkAvg', { avg: avg.toFixed(1) })}
            </span>
          </div>
        )}
      </Link>
    </Card>
  )
}
