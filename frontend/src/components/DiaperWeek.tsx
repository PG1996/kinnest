import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Diaper, DiaperKind } from '../api/hooks'
import { diaperWeek } from '../lib/diaperWeek'

const W = 320
const H = 150
const PAD = { top: 10, right: 6, bottom: 22, left: 24 }
const GAP = 2
const WET_TARGET = 6 // the usual newborn check: six or more wet diapers a day
// wet at the bottom, then both (also wet), then dirty: the wet line reads against the first two
const ORDER: DiaperKind[] = ['wet', 'both', 'dirty']
const COLOR: Record<DiaperKind, string> = { wet: 'var(--chart-wet)', both: 'var(--chart-both)', dirty: 'var(--chart-dirty)' }

/** Seven days of diapers as stacked bars by kind, the chosen day highlighted, with the six-wet line. */
export default function DiaperWeek({ diapers, day }: { diapers: Diaper[]; day: Date }) {
  const { t } = useTranslation()
  const week = diaperWeek(diapers, day)
  const [picked, setPicked] = useState<number | null>(null)
  const maxN = Math.max(WET_TARGET + 2, ...week.map((d) => d.wet + d.dirty + d.both))
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const unit = plotH / maxN
  const slot = plotW / 7
  const barW = Math.min(28, slot - 8)
  const base = PAD.top + plotH
  const ticks = [0, Math.round(maxN / 2), maxN]
  const label = (d: Date) => d.toLocaleDateString([], { weekday: 'narrow' })
  const tip = (i: number) => {
    const d = week[i]!
    return t('diapers.weekTip', { day: d.day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }), wet: d.wet, both: d.both, dirty: d.dirty })
  }

  return (
    <div className="space-y-2">
      <svg role="img" aria-label={t('diapers.weekLabel')} viewBox={`0 0 ${W} ${H}`} className="w-full">
        {ticks.map((n) => (
          <g key={n}>
            <line x1={PAD.left} x2={W - PAD.right} y1={base - n * unit} y2={base - n * unit} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.left - 6} y={base - n * unit} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--muted)">
              {n}
            </text>
          </g>
        ))}
        {week.map((d, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2
          const chosen = i === 6
          const segments = ORDER.filter((k) => d[k] > 0)
          return (
            <g
              key={d.day.toISOString()}
              data-day={i}
              aria-current={chosen ? 'date' : undefined}
              onClick={() => setPicked(picked === i ? null : i)}
              onMouseEnter={() => setPicked(i)}
              onMouseLeave={() => setPicked(null)}
              style={{ cursor: 'pointer' }}
            >
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH + PAD.bottom} fill="transparent" />
              {segments.map((k, j) => {
                const h = d[k] * unit - (j < segments.length - 1 ? GAP : 0)
                const y = base - segments.slice(0, j + 1).reduce((n, s) => n + d[s] * unit, 0)
                const top = j === segments.length - 1
                return top ? (
                  <path key={k} data-kind={k} d={`M${x},${y + h} V${y + 4} q0,-4 4,-4 h${barW - 8} q4,0 4,4 V${y + h} Z`} fill={COLOR[k]} fillOpacity={picked === null || picked === i ? 1 : 0.45} />
                ) : (
                  <rect key={k} data-kind={k} x={x} y={y + GAP} width={barW} height={Math.max(0, h)} fill={COLOR[k]} fillOpacity={picked === null || picked === i ? 1 : 0.45} />
                )
              })}
              <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize={11} fontWeight={chosen ? 800 : 500} fill={chosen ? 'var(--ink)' : 'var(--muted)'}>
                {label(d.day)}
              </text>
            </g>
          )
        })}
        <line data-testid="wet-target" x1={PAD.left} x2={W - PAD.right} y1={base - WET_TARGET * unit} y2={base - WET_TARGET * unit} stroke="var(--ink)" strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="4 3" />
        <text x={W - PAD.right} y={base - WET_TARGET * unit - 4} textAnchor="end" fontSize={10} fill="var(--muted)">
          {t('diapers.wetTarget')}
        </text>
      </svg>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
        {ORDER.map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-sm" style={{ background: COLOR[k] }} />
            {t(`diaperKinds.${k}`)}
          </span>
        ))}
      </div>
      <p role="status" className="min-h-5 text-center text-xs text-muted">
        {picked !== null ? tip(picked) : ''}
      </p>
    </div>
  )
}
