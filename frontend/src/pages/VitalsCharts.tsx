import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useVitals, type PlaceKind, type Vital } from '../api/hooks'
import GrowthChart from '../components/GrowthChart'
import TrendChart from '../components/TrendChart'
import { Input } from '../components/ui/field'
import { Segmented } from '../components/ui/segmented'
import { cn } from '../lib/cn'
import { PLACE_COLORS } from '../lib/placeColors'
import { MEASUREMENTS, type MeasurementKey } from '../lib/vitals'
import { PLACES } from '../lib/vitalsFormat'

const dayStart = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined)
const dayEnd = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined)

const TABS = ['weight_kg', 'height_cm', 'head_cm', 'temperature_c'] as const
type Tab = (typeof TABS)[number]
const OTHERS: MeasurementKey[] = ['heart_rate', 'resp_rate', 'spo2']

/** The most recent value of one measurement, by time taken. */
const latest = (vitals: Vital[], key: MeasurementKey): number | null => {
  let best: Vital | null = null
  for (const v of vitals) if (v[key] != null && (!best || Date.parse(v.measured_at) > Date.parse(best.measured_at))) best = v
  return best ? (best[key] as number) : null
}

/** Metric tabs with the latest values; the chosen metric's chart comes first, the rest follow. Shared filters sit under the tabs. */
export default function VitalsCharts() {
  const { t } = useTranslation()
  const [hidden, setHidden] = useState<Set<PlaceKind>>(new Set())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [tab, setTab] = useState<Tab>('weight_kg')
  const vitals = (useVitals({ from: dayStart(from), to: dayEnd(to) }).data ?? []).filter((v) => !hidden.has(v.place_kind))
  const flip = (p: PlaceKind) => {
    const next = new Set(hidden)
    if (next.has(p)) next.delete(p)
    else next.add(p)
    setHidden(next)
  }

  const charts: Record<Tab, ReactNode> = {
    weight_kg: <GrowthChart key="weight" kind="weight" hidden={hidden} />,
    height_cm: <GrowthChart key="height" kind="height" hidden={hidden} />,
    head_cm: <GrowthChart key="head" kind="head" hidden={hidden} />,
    temperature_c: <TrendChart key="temperature_c" measurement="temperature_c" vitals={vitals} />,
  }
  const options = TABS.map((k) => {
    const m = MEASUREMENTS.find((x) => x.key === k)!
    const v = latest(vitals, k)
    return { value: k, label: v == null ? t(m.label) : `${t(m.label)} ${v}` }
  })

  return (
    <div className="space-y-4">
      <Segmented kind="tab" label={t('vitals.charts.metrics')} value={tab} options={options} onChange={setTab} />
      <fieldset className="space-y-2">
        <legend className="text-sm text-muted">{t('vitals.charts.showPlaces')}</legend>
        <div className="flex flex-wrap gap-2">
          {PLACES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={!hidden.has(p)}
              onClick={() => flip(p)}
              className={cn('flex min-h-11 items-center gap-2 rounded-full border-2 px-3 text-sm font-bold', hidden.has(p) ? 'border-line opacity-50' : 'border-ink/30')}
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
      {charts[tab]}
      {TABS.filter((k) => k !== tab).map((k) => charts[k])}
      {OTHERS.map((k) => (
        <TrendChart key={k} measurement={k} vitals={vitals} />
      ))}
    </div>
  )
}
