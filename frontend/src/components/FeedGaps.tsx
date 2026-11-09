import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Feed } from '../api/hooks'
import { feedGaps, type FeedGap } from '../lib/feedDay'
import { formatAgo, formatTime } from '../lib/time'

const W = 320
const H = 140
const PAD = { top: 12, right: 8, bottom: 8, left: 30 }
const GAP = 2

/** One bar per gap between feeds; the dashed line is the feed interval, and gaps past it are drawn solid. */
export default function FeedGaps({ feeds, intervalMin }: { feeds: Feed[]; intervalMin: number | undefined }) {
  const { t } = useTranslation()
  const [picked, setPicked] = useState<number | null>(null)
  const gaps = feedGaps(feeds)
  if (gaps.length === 0) return null
  const target = intervalMin ?? 180
  const maxMin = Math.max(target * 1.25, ...gaps.map((g) => g.minutes))
  const maxH = Math.ceil(maxMin / 60)
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const y = (min: number) => PAD.top + plotH - (min / (maxH * 60)) * plotH
  const slot = plotW / gaps.length
  const barW = Math.min(36, slot - GAP * 2)
  const ticks = Array.from({ length: maxH + 1 }, (_, h) => h).filter((h) => maxH <= 6 || h % 2 === 0)
  const tip = (g: FeedGap) => t('feeds.gapTip', { from: formatTime(g.from), to: formatTime(g.to), gap: formatAgo(g.minutes * 60_000) })
  const longest = gaps.reduce((best, g, i) => (g.minutes > gaps[best]!.minutes ? i : best), 0)

  return (
    <div className="space-y-2">
      <svg role="img" aria-label={t('feeds.gapsLabel')} viewBox={`0 0 ${W} ${H}`} className="w-full">
        {ticks.map((h) => (
          <g key={h}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(h * 60)} y2={y(h * 60)} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(h * 60)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--muted)">
              {h}h
            </text>
          </g>
        ))}
        {gaps.map((g, i) => {
          const over = g.minutes > target
          const x = PAD.left + i * slot + (slot - barW) / 2
          const top = y(g.minutes)
          const h = Math.max(2, PAD.top + plotH - top)
          return (
            <g key={g.to} data-gap={i} data-over={String(over)} onClick={() => setPicked(picked === i ? null : i)} onMouseEnter={() => setPicked(i)} onMouseLeave={() => setPicked(null)} style={{ cursor: 'pointer' }}>
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" />
              {/* rounded at the data end, square on the baseline */}
              <path
                d={`M${x},${top + h} V${top + 4} q0,-4 4,-4 h${barW - 8} q4,0 4,4 V${top + h} Z`}
                fill={over ? 'var(--feed-ink)' : 'var(--feed)'}
                fillOpacity={picked === null || picked === i ? 1 : 0.45}
              />
              {i === longest && (
                <text x={x + barW / 2} y={top - 3} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--ink)">
                  {formatAgo(g.minutes * 60_000)}
                </text>
              )}
            </g>
          )
        })}
        <line data-testid="gap-target" x1={PAD.left} x2={W - PAD.right} y1={y(target)} y2={y(target)} stroke="var(--ink)" strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="4 3" />
        <text x={W - PAD.right} y={y(target) - 4} textAnchor="end" fontSize={10} fill="var(--muted)">
          {t('feeds.gapTarget', { every: formatAgo(target * 60_000) })}
        </text>
      </svg>
      <p role="status" className="min-h-5 text-center text-xs text-muted">
        {picked !== null && gaps[picked] ? tip(gaps[picked]) : ''}
      </p>
    </div>
  )
}
