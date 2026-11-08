import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useVitals, type PlaceKind } from '../api/hooks'
import GrowthChart from '../components/GrowthChart'
import TrendChart from '../components/TrendChart'
import { Input } from '../components/ui/field'
import { cn } from '../lib/cn'
import { PLACE_COLORS } from '../lib/placeColors'
import { PLACES } from '../lib/vitalsFormat'

const dayStart = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined)
const dayEnd = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined)

/** Growth against WHO curves, then temperature, heart rate, breathing rate and SpO2 trends, with shared filters. */
export default function VitalsCharts() {
  const { t } = useTranslation()
  const [hidden, setHidden] = useState<Set<PlaceKind>>(new Set())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const vitals = (useVitals({ from: dayStart(from), to: dayEnd(to) }).data ?? []).filter((v) => !hidden.has(v.place_kind))
  const flip = (p: PlaceKind) => {
    const next = new Set(hidden)
    if (next.has(p)) next.delete(p)
    else next.add(p)
    setHidden(next)
  }
  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm text-muted">{t('vitals.charts.showPlaces')}</legend>
        <div className="flex flex-wrap gap-2">
          {PLACES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={!hidden.has(p)}
              onClick={() => flip(p)}
              className={cn('flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm', hidden.has(p) ? 'border-line opacity-50' : 'border-ink/30')}
            >
              <span aria-hidden className="size-3 rounded-full" style={{ background: PLACE_COLORS[p] }} />
              {t(`vitals.places.${p}`)}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="col-span-2 text-sm text-muted">{t('vitals.charts.range')}</legend>
        <div>
          <label htmlFor="charts-from" className="block text-xs text-muted">
            {t('vitals.list.from')}
          </label>
          <Input id="charts-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label htmlFor="charts-to" className="block text-xs text-muted">
            {t('vitals.list.to')}
          </label>
          <Input id="charts-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </fieldset>
      <GrowthChart kind="weight" hidden={hidden} />
      <GrowthChart kind="height" hidden={hidden} />
      <GrowthChart kind="head" hidden={hidden} />
      <TrendChart measurement="temperature_c" vitals={vitals} />
      <TrendChart measurement="heart_rate" vitals={vitals} />
      <TrendChart measurement="resp_rate" vitals={vitals} />
      <TrendChart measurement="spo2" vitals={vitals} />
    </div>
  )
}
