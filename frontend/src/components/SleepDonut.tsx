import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SleepDay, SleepSegment } from '../lib/sleepDay'
import { formatAgo, formatHour, formatTime } from '../lib/time'

const DAY_MS = 86_400_000
const COLORS: Record<SleepSegment['kind'], string> = { sleep: 'var(--sleep)', awake: 'var(--feed)', future: 'var(--line)' }
const OPACITY: Record<SleepSegment['kind'], number> = { sleep: 1, awake: 0.45, future: 1 }

/** A 24-hour ring, midnight at the top, coloured by asleep and awake. The centre shows the totals, or the piece being pointed at. */
export default function SleepDonut({ day, data, compact = false }: { day: Date; data: SleepDay; /** a small, read-only ring for the Home card: no labels, legend or hover */ compact?: boolean }) {
  const { t } = useTranslation()
  const SIZE = compact ? 72 : 220
  const STROKE = compact ? 10 : 22
  const R = SIZE / 2 - STROKE / 2 - (compact ? 1 : 11)
  const C = 2 * Math.PI * R
  const [hover, setHover] = useState<SleepSegment | null>(null)
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const span = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime() - start || DAY_MS
  const sleep = formatAgo(data.sleepMin * 60_000)
  const awake = formatAgo(data.awakeMin * 60_000)
  const ring = (seg: SleepSegment) => {
    const from = ((seg.start.getTime() - start) / span) * C
    const len = Math.max(0, ((seg.end.getTime() - seg.start.getTime()) / span) * C - (compact ? 0.5 : 1.5))
    return { from, len }
  }
  if (compact)
    return (
      <svg role="img" aria-label={t('sleep.donutLabel', { sleep, awake })} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="shrink-0">
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--surface-2)" strokeWidth={STROKE} />
          {data.segments.map((seg) => {
            const { from, len } = ring(seg)
            return (
              <circle key={`${seg.kind}-${seg.start.getTime()}`} data-kind={seg.kind} cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={COLORS[seg.kind]} strokeOpacity={OPACITY[seg.kind]} strokeWidth={STROKE} strokeDasharray={`${len} ${C}`} strokeDashoffset={-from} />
            )
          })}
        </g>
      </svg>
    )
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg role="img" aria-label={t('sleep.donutLabel', { sleep, awake })} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--surface-2)" strokeWidth={STROKE} />
            {data.segments.map((seg) => {
              const from = ((seg.start.getTime() - start) / span) * C
              const len = Math.max(0, ((seg.end.getTime() - seg.start.getTime()) / span) * C - 1.5) // a hairline gap between pieces
              return (
                <circle
                  key={`${seg.kind}-${seg.start.getTime()}`}
                  data-kind={seg.kind}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  fill="none"
                  stroke={COLORS[seg.kind]}
                  strokeOpacity={OPACITY[seg.kind]}
                  strokeWidth={hover === seg ? STROKE + 4 : STROKE}
                  strokeDasharray={`${len} ${C}`}
                  strokeDashoffset={-from}
                  strokeLinecap="butt"
                  onMouseEnter={() => setHover(seg)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setHover(hover === seg ? null : seg)}
                  style={{ transition: 'stroke-width 150ms ease', cursor: 'pointer' }}
                />
              )
            })}
          </g>
        </svg>
        {[0, 6, 12, 18].map((h, i) => (
          <span
            key={h}
            aria-hidden="true"
            className="absolute text-[10px] font-semibold text-muted"
            style={[
              { top: -2, left: '50%', transform: 'translate(-50%, -100%)' },
              { right: -4, top: '50%', transform: 'translate(100%, -50%)' },
              { bottom: -2, left: '50%', transform: 'translate(-50%, 100%)' },
              { left: -4, top: '50%', transform: 'translate(-100%, -50%)' },
            ][i]}
          >
            {formatHour(h)}
          </span>
        ))}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {hover ? (
            <>
              <span className="text-xs font-semibold text-muted">{t(hover.kind === 'sleep' ? 'sleep.legendSleep' : hover.kind === 'awake' ? 'sleep.legendAwake' : 'sleep.legendFuture')}</span>
              <span className="text-lg font-bold">{formatAgo(hover.end.getTime() - hover.start.getTime())}</span>
              <span className="text-xs text-muted">{t('sleep.range', { from: formatTime(hover.start), to: formatTime(hover.end) })}</span>
            </>
          ) : (
            <>
              <span className="text-xl font-bold tabular-nums">{sleep}</span>
              <span className="text-xs font-semibold text-muted">{t('sleep.sleptTotal')}</span>
              <span className="mt-1 text-sm font-semibold tabular-nums">{awake}</span>
              <span className="text-xs text-muted">{t('sleep.awakeTotal')}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: COLORS.sleep }} />
          {t('sleep.legendSleep')}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: COLORS.awake, opacity: OPACITY.awake }} />
          {t('sleep.legendAwake')}
        </span>
        {data.futureMin > 0 && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: COLORS.future }} />
            {t('sleep.legendFuture')}
          </span>
        )}
      </div>
    </div>
  )
}
