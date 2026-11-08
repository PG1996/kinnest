import { useTranslation } from 'react-i18next'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PlaceKind, Vital } from '../api/hooks'
import { PLACE_COLORS } from '../lib/placeColors'
import { MEASUREMENTS, type MeasurementKey } from '../lib/vitals'
import { formatPlace, formatWhen } from '../lib/vitalsFormat'
import { Card } from './ui/card'

const FEVER_C = 38

type Row = { t: number; value: number; place_kind: PlaceKind; id: string; measured_at: string }

/** A plain trend line for one measurement; temperature also gets a dashed 38.0 °C line, as information only. */
export default function TrendChart({ measurement, vitals }: { measurement: MeasurementKey; vitals: Vital[] }) {
  const { t } = useTranslation()
  const m = MEASUREMENTS.find((x) => x.key === measurement)!
  const unit = t(m.unit)
  const rows: Row[] = vitals
    .filter((v) => v[measurement] != null)
    .map((v) => ({ t: Date.parse(v.measured_at), value: v[measurement] as number, place_kind: v.place_kind, id: v.id, measured_at: v.measured_at }))
    .sort((a, b) => a.t - b.t)
  return (
    <Card role="figure" aria-label={t(m.label)} className="space-y-2 p-4">
      <h3 className="font-medium">{`${t(m.label)} (${unit})`}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t('vitals.charts.noData')}</p>
      ) : (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line, #ddd)" />
              <XAxis
                type="number"
                dataKey="t"
                domain={['dataMin', 'dataMax']}
                scale="time"
                tick={{ fontSize: 11 }}
                tickFormatter={(x: number) => new Date(x).toLocaleDateString([], { day: 'numeric', month: 'short' })}
              />
              <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} />
              {measurement === 'temperature_c' && (
                <ReferenceLine
                  y={FEVER_C}
                  stroke="#c2410c"
                  strokeDasharray="6 4"
                  ifOverflow="extendDomain"
                  label={{ value: t('vitals.charts.feverLine'), position: 'insideTopLeft', fontSize: 10 }}
                />
              )}
              <Line
                dataKey="value"
                stroke="#334155"
                strokeWidth={2}
                isAnimationActive={false}
                dot={(props: { cx?: number; cy?: number; payload?: Row; index?: number }) => (
                  <circle
                    key={props.payload?.id ?? props.index}
                    cx={props.cx}
                    cy={props.cy}
                    r={4}
                    fill={PLACE_COLORS[props.payload?.place_kind ?? 'other']}
                    data-point={props.payload?.place_kind}
                  />
                )}
              />
              <Tooltip
                labelFormatter={(x) => formatWhen(new Date(Number(x)).toISOString())}
                formatter={(v, _n, item) => [`${v} ${unit}`, formatPlace(t, (item.payload as Row).place_kind)]}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}
