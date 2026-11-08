import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { Summary } from '../api/hooks'
import { MEASUREMENTS } from '../lib/vitals'
import { formatPlace, formatValue, formatWhen } from '../lib/vitalsFormat'
import { linkButtonClass } from './ui/button'
import { Card } from './ui/card'

const KEYS = ['weight_kg', 'height_cm', 'head_cm', 'temperature_c'] as const

/** Home card: the latest weight, height, head and temperature, each with its own date and place. */
export default function LatestVitalsCard({ latest, canLog }: { latest: NonNullable<Summary['vitals']>['latest']; canLog: boolean }) {
  const { t } = useTranslation()
  const items = KEYS.flatMap((k) => {
    const v = latest[k]
    return v && v[k] != null ? [{ key: k, entry: v, value: v[k] as number }] : []
  })
  if (items.length === 0 && !canLog) return null
  return (
    <Card role="region" aria-label={t('vitals.card.title')} className="space-y-2">
      <h2 className="font-medium">{t('vitals.card.title')}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t('vitals.card.empty')}</p>
      ) : (
        <>
          <p className="text-lg font-semibold">{items.map((i) => formatValue(t, i.key, i.value)).join(' · ')}</p>
          <ul className="space-y-0.5 text-xs text-muted">
            {items.map((i) => (
              <li key={i.key}>
                {`${t(MEASUREMENTS.find((m) => m.key === i.key)!.label)}: ${formatWhen(i.entry.measured_at)} · ${formatPlace(t, i.entry.place_kind, i.entry.place_name)}`}
              </li>
            ))}
          </ul>
        </>
      )}
      {canLog && (
        <Link to="/health?tab=vitals&add=1" className={linkButtonClass('soft')}>
          {t('vitals.add')}
        </Link>
      )}
    </Card>
  )
}
