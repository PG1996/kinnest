import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { Summary } from '../api/hooks'
import { cn } from '../lib/cn'
import { formatAgo } from '../lib/time'
import { MEASUREMENTS } from '../lib/vitals'
import { formatDelta, formatValue } from '../lib/vitalsFormat'
import { Card } from './ui/card'

const KEYS = ['weight_kg', 'height_cm', 'temperature_c', 'heart_rate', 'spo2'] as const
const FEVER_C = 38

/** Home card: the latest weight, height, temperature, heart rate and SpO2 as small value tiles with the change since the reading before, with one "updated" note. */
/** Three over two like the Vitals stat cards; fewer tiles share the row evenly. */
const span = (i: number, n: number) => (n === 5 ? (i < 3 ? 'col-span-2' : 'col-span-3') : n === 4 ? 'col-span-3' : n === 3 ? 'col-span-2' : n === 2 ? 'col-span-3' : 'col-span-6')

export default function LatestVitalsCard({
  latest,
  previous = {},
  canLog,
  now = Date.now(),
}: {
  latest: NonNullable<Summary['vitals']>['latest']
  previous?: NonNullable<NonNullable<Summary['vitals']>['previous']>
  canLog: boolean
  now?: number
}) {
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
        <Link to="/health?tab=vitals" className="flex min-w-0 flex-1 items-baseline gap-2">
          <h2 className="text-sm font-semibold">{t('vitals.card.title')}</h2>
          {newest > 0 && <span className="truncate text-xs text-muted">{t('vitals.card.updated', { ago: formatAgo(now - newest) })}</span>}
        </Link>
        {canLog && (
          <Link
            to="/health?tab=vitals&add=1"
            aria-label={t('vitals.add')}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-med-ink"
          >
            <Plus size={18} aria-hidden="true" />
          </Link>
        )}
      </div>
      <Link to="/health?tab=vitals" aria-label={t('vitals.card.open')} className="block">
        {items.length === 0 ? (
          <p className="text-sm text-muted">{t('vitals.card.empty')}</p>
        ) : (
          <div className="grid grid-cols-6 gap-2">
            {items.map((i, n) => {
              const fever = i.key === 'temperature_c' && i.value >= FEVER_C
              const before = previous[i.key]
              return (
                <div key={i.key} data-testid="vital-tile" className={cn('min-w-0 space-y-0.5 rounded-tile px-2.5 py-2', span(n, items.length), fever ? 'bg-warn-bg text-warn-ink' : 'bg-surface-2/70')}>
                  <span className="block truncate text-[11px] font-semibold text-muted">{t(MEASUREMENTS.find((m) => m.key === i.key)!.label)}</span>
                  <span className="block truncate text-base font-bold tabular-nums">{formatValue(t, i.key, i.value)}</span>
                  {fever && <span className="block text-[11px] font-bold">{t('vitals.card.fever')}</span>}
                  {before != null && (
                    <span data-testid="stat-delta" className="inline-block max-w-full truncate rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted">
                      {formatDelta(t, i.key, i.value, before)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Link>
    </Card>
  )
}
