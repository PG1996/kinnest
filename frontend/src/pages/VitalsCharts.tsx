import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useVitals, type PlaceKind } from '../api/hooks'
import GrowthChart from '../components/GrowthChart'
import TrendChart from '../components/TrendChart'
import { Input } from '../components/ui/field'
import StatTabs from '../components/StatTabs'
import { cn } from '../lib/cn'
import { PLACE_COLORS } from '../lib/placeColors'

import { useTempUnit } from '../lib/tempUnit'
import { PLACES } from '../lib/vitalsFormat'

const dayStart = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined)
const dayEnd = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined)

const TABS = ['weight_kg', 'height_cm', 'temperature_c', 'heart_rate', 'spo2'] as const
// head circumference and breathing rate join the cards only under "More vitals"
const MORE = ['head_cm', 'resp_rate'] as const
type Tab = (typeof TABS)[number] | (typeof MORE)[number]


/** Metric stat cards with the latest values; only the chosen metric's chart is drawn. Shared filters sit under the tabs. */
export default function VitalsCharts() {
  const { t } = useTranslation()
  const [hidden, setHidden] = useState<Set<PlaceKind>>(new Set())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [tab, setTab] = useState<Tab>('weight_kg')
  const [more, setMore] = useState(false)
  useTempUnit() // re-render when °F / °C changes
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
    temperature_c: <TrendChart key="temperature_c" measurement="temperature_c" vitals={vitals} />,
    heart_rate: <TrendChart key="heart_rate" measurement="heart_rate" vitals={vitals} />,
    spo2: <TrendChart key="spo2" measurement="spo2" vitals={vitals} />,
    head_cm: <GrowthChart key="head" kind="head" hidden={hidden} />,
    resp_rate: <TrendChart key="resp_rate" measurement="resp_rate" vitals={vitals} />,
  }
  return (
    <div className="space-y-4">
      <StatTabs keys={more ? [...TABS, ...MORE] : TABS} vitals={vitals} value={tab} onChange={setTab} />
      <button
        type="button"
        aria-expanded={more}
        onClick={() => {
          // closing More while one of its charts is shown goes back to weight
          if (more && (MORE as readonly string[]).includes(tab)) setTab('weight_kg')
          setMore(!more)
        }}
        className="flex min-h-10 w-full items-center justify-center rounded-xl border border-dashed border-line text-sm font-semibold text-muted"
      >
        {t('vitals.charts.more')}
      </button>
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
    </div>
  )
}
