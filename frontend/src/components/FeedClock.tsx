import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Feed } from '../api/hooks'
import { formatHour, formatTime } from '../lib/time'

const SIZE = 220
const STROKE = 18
const R = SIZE / 2 - STROKE / 2 - 11
const C = 2 * Math.PI * R
const DAY = 86_400_000

/** A 24-hour ring, midnight at the top: an arc for each breastfeed (as long as it lasted) and a dot for each bottle. */
export default function FeedClock({ day, feeds }: { day: Date; feeds: Feed[] }) {
  const { t } = useTranslation()
  const [picked, setPicked] = useState<Feed | null>(null)
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const span = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime() - start || DAY
  const frac = (iso: string) => (Date.parse(iso) - start) / span
  const point = (f: number) => {
    const a = f * 2 * Math.PI - Math.PI / 2
    return { x: SIZE / 2 + R * Math.cos(a), y: SIZE / 2 + R * Math.sin(a) }
  }
  const breast = feeds.filter((f) => f.type.startsWith('breast'))
  const bottle = feeds.filter((f) => !f.type.startsWith('breast'))
  const amount = (f: Feed) => (f.quantity_ml != null ? `${f.quantity_ml} ml` : f.duration_min != null ? `${f.duration_min} min` : '')
  const toggle = (f: Feed) => setPicked(picked?.id === f.id ? null : f)

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg role="img" aria-label={t('feeds.clockLabel', { count: feeds.length })} width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--surface-2)" strokeWidth={STROKE} />
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {breast.map((f) => {
              // at least a sliver, so a feed with no duration still shows
              const len = Math.max(C * 0.008, ((f.duration_min ?? 0) * 60_000 / span) * C)
              return (
                <circle
                  key={f.id}
                  data-kind="breast"
                  data-id={f.id}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  fill="none"
                  stroke="var(--feed)"
                  strokeWidth={picked?.id === f.id ? STROKE + 4 : STROKE}
                  strokeDasharray={`${len} ${C}`}
                  strokeDashoffset={-frac(f.started_at) * C}
                  onClick={() => toggle(f)}
                  onMouseEnter={() => setPicked(f)}
                  onMouseLeave={() => setPicked(null)}
                  style={{ cursor: 'pointer', transition: 'stroke-width 150ms ease' }}
                />
              )
            })}
          </g>
          {bottle.map((f) => {
            const p = point(frac(f.started_at))
            return (
              <g key={f.id} data-kind="bottle" data-id={f.id} onClick={() => toggle(f)} onMouseEnter={() => setPicked(f)} onMouseLeave={() => setPicked(null)} style={{ cursor: 'pointer' }}>
                {/* a bigger invisible target than the dot */}
                <circle cx={p.x} cy={p.y} r={14} fill="transparent" />
                <circle cx={p.x} cy={p.y} r={picked?.id === f.id ? 8 : 6} fill="var(--feed-ink)" stroke="var(--surface)" strokeWidth={2} />
              </g>
            )
          })}
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
        <div data-testid="feed-clock-centre" aria-live="polite" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          {picked ? (
            <>
              <span className="text-xs font-semibold text-muted">{t(`feedTypes.${picked.type}`)}</span>
              <span className="text-lg font-bold">{formatTime(picked.started_at)}</span>
              <span className="text-xs text-muted">{amount(picked)}</span>
            </>
          ) : (
            <>
              <span className="text-xl font-bold tabular-nums">{feeds.length}</span>
              <span className="text-xs font-semibold text-muted">{t('feeds.centreFeeds')}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-4 rounded-full" style={{ background: 'var(--feed)' }} />
          {t('feeds.legendBreast')}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: 'var(--feed-ink)' }} />
          {t('feeds.legendBottle')}
        </span>
      </div>
    </div>
  )
}
