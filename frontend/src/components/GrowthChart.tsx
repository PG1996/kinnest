import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useGrowth, type GrowthCurves, type GrowthKind, type PlaceKind } from '../api/hooks'
import { PLACE_COLORS } from '../lib/placeColors'
import { formatPlace, formatWhen } from '../lib/vitalsFormat'
import { Card } from './ui/card'

const PERCENTILES = ['3', '15', '50', '85', '97'] as const
const UNIT: Record<GrowthKind, string> = { weight: 'vitals.units.weight_kg', height: 'vitals.units.height_cm', head: 'vitals.units.head_cm' }
type Point = GrowthCurves['points'][number] & { month: number }

export function GrowthTooltipContent({
  active,
  payload,
  unit,
}: {
  active?: boolean
  payload?: { payload: Partial<Point> }[]
  unit: string
}) {
  const { t } = useTranslation()
  const p = payload?.find((x) => x.payload.id)?.payload
  if (!active || !p || p.value == null || !p.place_kind || !p.measured_at) return null
  return (
    <div className="rounded-xl border border-line bg-surface p-2 text-xs shadow">
      <p>{formatWhen(p.measured_at)}</p>
      <p className="font-medium">{`${p.value} ${unit}`}</p>
      <p>{t('vitals.charts.percentile', { value: p.percentile })}</p>
      <p>{formatPlace(t, p.place_kind)}</p>
    </div>
  )
}

/** The child's readings against the WHO percentile curves (girls, 0 to 60 months). */
export default function GrowthChart({ kind, hidden }: { kind: GrowthKind; hidden: Set<PlaceKind> }) {
  const { t } = useTranslation()
  const growth = useGrowth(kind)
  const title = t(`vitals.charts.growth.${kind}`)
  const unit = t(UNIT[kind])
  if (growth.isPending) return null
  const data = growth.data
  return (
    <Card role="figure" aria-label={title} className="space-y-2 p-4">
      <h3 className="font-medium">{`${title} (${unit})`}</h3>
      {data === null || data === undefined ? (
        <p className="text-sm text-muted">
          <span>{t('vitals.charts.noBirthDate')}</span>{' '}
          <Link to="/settings" className="text-primary underline">
            {t('vitals.charts.noBirthDateLink')}
          </Link>
        </p>
      ) : (
        <GrowthPlot data={data} hidden={hidden} unit={unit} />
      )}
    </Card>
  )
}

function GrowthPlot({ data, hidden, unit }: { data: GrowthCurves; hidden: Set<PlaceKind>; unit: string }) {
  const { t } = useTranslation()
  const points: Point[] = data.points.filter((p) => !hidden.has(p.place_kind)).map((p) => ({ ...p, month: p.age_months }))
  const oldest = Math.max(0, ...data.points.map((p) => p.age_months))
  const maxMonth = Math.min(60, Math.max(6, Math.ceil(oldest) + 3))
  const curve = (p: (typeof PERCENTILES)[number]) =>
    data.curves[p].filter(([m]) => m <= maxMonth).map(([month, value]) => ({ month, value }))
  return (
    <>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line, #ddd)" />
            <XAxis type="number" dataKey="month" domain={[0, maxMonth]} allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis type="number" dataKey="value" domain={['auto', 'auto']} tick={{ fontSize: 11 }} />
            {PERCENTILES.map((p) => (
              <Line
                key={p}
                data={curve(p)}
                dataKey="value"
                name={t('vitals.charts.percentileLine', { p })}
                stroke={p === '50' ? '#94a3b8' : '#cbd5e1'}
                strokeWidth={p === '50' ? 2 : 1}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
                className="who-curve"
                data-curve={p}
              />
            ))}
            <Line
              data={points}
              dataKey="value"
              stroke="#334155"
              strokeWidth={2}
              isAnimationActive={false}
              dot={(props: { cx?: number; cy?: number; payload?: Point; index?: number }) => (
                <circle
                  key={props.payload?.id ?? props.index}
                  cx={props.cx}
                  cy={props.cy}
                  r={5}
                  fill={PLACE_COLORS[props.payload?.place_kind ?? 'other']}
                  data-point={props.payload?.place_kind}
                />
              )}
            />
            <Tooltip content={<GrowthTooltipContent unit={unit} />} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted">{t('vitals.charts.months')}</p>
      <p className="text-xs text-muted">
        {t('vitals.charts.source', { name: data.source.name, date: data.source.retrieved_on })}{' '}
        <a href={data.source.url} target="_blank" rel="noreferrer" className="underline">
          {data.source.url.replace(/^https:\/\//, '')}
        </a>
      </p>
      <p className="text-xs text-muted">{t('vitals.charts.info')}</p>
    </>
  )
}
