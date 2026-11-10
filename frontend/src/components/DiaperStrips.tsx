import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Diaper, DiaperKind } from '../api/hooks'
import { diaperStrips } from '../lib/diaperDays'
import { formatHour, formatTime } from '../lib/time'
import { IconButton } from './ui/button'
import { Segmented } from './ui/segmented'

const COLOR: Record<DiaperKind, string> = { wet: 'var(--chart-wet)', both: 'var(--chart-both)', dirty: 'var(--chart-dirty)' }
const KINDS: DiaperKind[] = ['wet', 'dirty', 'both']
type Span = '1440' | '720' | '360'
// a tick every 6, 3 or 1 hours, so the axis stays readable at each zoom
const TICK: Record<Span, number> = { 1440: 360, 720: 180, 360: 60 }

const W = 336
const X0 = 58
const X1 = W - 8
const ROW = 26
const ROW_GAP = 5
const AXIS = 18
const H = 7 * (ROW + ROW_GAP) + AXIS

/** One diaper: a circle for wet, a square for dirty, a diamond for both, drawn as vectors with a gap ring so close ones stay apart. */
function Shape({ kind, cx, cy, pos }: { kind: DiaperKind; cx: number; cy: number; pos: number }) {
  const common = { 'data-kind': kind, 'data-pos': pos.toFixed(4), fill: COLOR[kind], stroke: 'var(--surface)', strokeWidth: 2, paintOrder: 'stroke' as const }
  if (kind === 'wet') return <circle {...common} cx={cx} cy={cy} r={5.5} />
  if (kind === 'dirty') return <rect {...common} x={cx - 5} y={cy - 5} width={10} height={10} rx={2} />
  return <polygon {...common} points={`${cx},${cy - 7} ${cx + 7},${cy} ${cx},${cy + 7} ${cx - 7},${cy}`} strokeLinejoin="round" />
}

/**
 * Seven days as strips, a mark for every change: when they happen and the gaps between. The zoom shows 24, 12 or 6 hours at a
 * time, so marks that sit close together can be told apart; tap a mark for its time and who changed it.
 */
export default function DiaperStrips({ diapers, day, nowMs }: { diapers: Diaper[]; day: Date; nowMs: number }) {
  const { t } = useTranslation()
  const strips = diaperStrips(diapers, day)
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  const nowMinute = (nowMs - dayStart.getTime()) / 60_000
  const showNow = nowMinute >= 0 && nowMinute < 1440
  const [span, setSpan] = useState<Span>('1440')
  const [start, setStart] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const length = Number(span)
  const clamp = (n: number, len = length) => Math.min(Math.max(0, n), 1440 - len)
  const zoom = (next: Span) => {
    const len = Number(next)
    setSpan(next)
    setStart(next === '1440' ? 0 : clamp(Math.round((showNow ? nowMinute : 720) - len / 2), len)) // around now, or midday on a past day
  }
  const end = start + length
  const plotW = X1 - X0
  const x = (minute: number) => X0 + ((minute - start) / length) * plotW
  const ticks: number[] = []
  for (let m = Math.ceil(start / TICK[span]) * TICK[span]; m <= end; m += TICK[span]) ticks.push(m)
  const clock = (minute: number) => formatTime(new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 0, minute))
  const byId = new Map(diapers.map((d) => [d.id, d]))
  const pickedDiaper = picked ? byId.get(picked) : undefined
  const press = (id: string) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setPicked(picked === id ? null : id)
    }
  }

  return (
    // the strips have their own zoom and panning: a swipe here is not a swipe to another day
    <div data-no-swipe className="space-y-2">
      <Segmented
        label={t('diapers.zoomLabel')}
        value={span}
        onChange={zoom}
        options={[
          { value: '1440', label: t('diapers.zoom24') },
          { value: '720', label: t('diapers.zoom12') },
          { value: '360', label: t('diapers.zoom6') },
        ]}
      />
      {span !== '1440' && (
        <div className="flex items-center justify-between">
          <IconButton label={t('diapers.zoomEarlier')} onClick={() => setStart(clamp(start - length))} disabled={start === 0} className="disabled:opacity-40">
            <ChevronLeft size={18} aria-hidden="true" />
          </IconButton>
          <span className="text-sm font-semibold tabular-nums">{`${clock(start)} – ${clock(end)}`}</span>
          <IconButton label={t('diapers.zoomLater')} onClick={() => setStart(clamp(start + length))} disabled={end >= 1440} className="disabled:opacity-40">
            <ChevronRight size={18} aria-hidden="true" />
          </IconButton>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" shapeRendering="geometricPrecision">
        {strips.map((s, i) => {
          const chosen = i === 6
          const y = i * (ROW + ROW_GAP)
          const cy = y + ROW / 2
          const label = chosen && showNow ? t('timeline.today') : s.day.toLocaleDateString([], { weekday: 'short', day: 'numeric' })
          return (
            <g
              key={s.day.toISOString()}
              data-strip={i}
              role="group"
              aria-current={chosen ? 'date' : undefined}
              aria-label={t('diapers.stripLabel', { day: s.day.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' }), wet: s.wet, dirty: s.dirty })}
            >
              <text x={0} y={cy} dominantBaseline="central" fontSize={11} fontWeight={chosen ? 800 : 500} fill={chosen ? 'var(--ink)' : 'var(--muted)'}>
                {label}
              </text>
              <rect x={X0} y={y} width={plotW} height={ROW} rx={ROW / 2} fill="var(--line)" fillOpacity={0.6} />
              {ticks.map((m) => (
                <line key={m} x1={x(m)} x2={x(m)} y1={y + 5} y2={y + ROW - 5} stroke="var(--surface)" strokeWidth={1} />
              ))}
              {chosen && showNow && nowMinute >= start && nowMinute <= end && (
                <line data-testid="strip-now" x1={x(nowMinute)} x2={x(nowMinute)} y1={y} y2={y + ROW} stroke="var(--ink)" strokeOpacity={0.6} strokeWidth={2} strokeLinecap="round" />
              )}
              {s.dots
                .filter((d) => d.minute >= start && d.minute <= end)
                .map((d) => {
                  const dx = x(d.minute)
                  const a = byId.get(d.id)
                  return (
                    <g
                      key={d.id}
                      data-mark
                      role="button"
                      tabIndex={0}
                      aria-label={`${clock(d.minute)}, ${t(`diaperKinds.${d.kind}`)}${a ? `, ${t('home.by', { name: a.changed_by_name })}` : ''}`}
                      aria-pressed={picked === d.id}
                      onClick={() => setPicked(picked === d.id ? null : d.id)}
                      onKeyDown={press(d.id)}
                      style={{ cursor: 'pointer', outline: 'none' }}
                    >
                      <circle cx={dx} cy={cy} r={11} fill="transparent" />
                      <Shape kind={d.kind} cx={dx} cy={cy} pos={(d.minute - start) / length} />
                    </g>
                  )
                })}
            </g>
          )
        })}
        {ticks.map((m) => (
          <text key={m} x={x(m)} y={H - 4} textAnchor="middle" fontSize={10} fill="var(--muted)" aria-hidden="true">
            {formatHour((m / 60) % 24)}
          </text>
        ))}
      </svg>
      <p role="status" className="min-h-5 text-center text-xs text-muted">
        {pickedDiaper ? `${formatTime(pickedDiaper.at)} · ${t(`diaperKinds.${pickedDiaper.kind}`)} · ${t('home.by', { name: pickedDiaper.changed_by_name })}` : ''}
      </p>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
        {KINDS.map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
              <Shape kind={k} cx={8} cy={8} pos={0} />
            </svg>
            {t(`diaperKinds.${k}`)}
          </span>
        ))}
      </div>
    </div>
  )
}
