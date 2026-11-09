import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { Summary } from '../api/hooks'
import { cn } from '../lib/cn'
import { formatAgo } from '../lib/time'
import { MEASUREMENTS } from '../lib/vitals'
import { formatValue } from '../lib/vitalsFormat'
import { Card } from './ui/card'

const KEYS = ['weight_kg', 'height_cm', 'temperature_c', 'heart_rate', 'spo2'] as const
const FEVER_C = 38

/** Home card: the latest weight, height, temperature, heart rate and SpO2 as small value tiles, with one "updated" note. */
export default function LatestVitalsCard({ latest, canLog, now = Date.now() }: { latest: NonNullable<Summary['vitals']>['latest']; canLog: boolean; now?: number }) {
  const { t } = useTranslation()
  const items = KEYS.flatMap((k) => {
    const v = latest[k]
    return v && v[k] != null ? [{ key: k, entry: v, value: v[k] as number }] : []
  })
  if (items.length === 0 && !canLog) return null
  const newest = items.reduce((n, i) => Math.max(n, Date.parse(i.entry.measured_at)), 0)
  return (
    <Card role="region" aria-label={t('vitals.card.title')} className="space-y-2.5 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('vitals.card.title')}</h2>
        <div className="flex items-center gap-2">
          {newest > 0 && <span className="text-xs text-muted">{t('vitals.card.updated', { ago: formatAgo(now - newest) })}</span>}
          {canLog && (
            <Link
              to="/health?tab=vitals&add=1"
              aria-label={t('vitals.add')}
              className="flex size-9 items-center justify-center rounded-full bg-primary-soft text-med-ink"
            >
              <Plus size={18} aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t('vitals.card.empty')}</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {items.map((i) => {
            const fever = i.key === 'temperature_c' && i.value >= FEVER_C
            return (
              <div key={i.key} className={cn('rounded-tile px-3 py-2', fever ? 'bg-warn-bg text-warn-ink' : 'bg-surface-2/70')}>
                <span className="block text-[11px] font-semibold text-muted">{t(MEASUREMENTS.find((m) => m.key === i.key)!.label)}</span>
                <span className="block text-base font-bold tabular-nums">{formatValue(t, i.key, i.value)}</span>
                {fever && <span className="block text-[11px] font-bold">{t('vitals.card.fever')}</span>}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
