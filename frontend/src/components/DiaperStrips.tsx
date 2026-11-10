import { useTranslation } from 'react-i18next'
import type { Diaper, DiaperKind } from '../api/hooks'
import { cn } from '../lib/cn'
import { diaperStrips } from '../lib/diaperDays'
import { formatHour } from '../lib/time'

const COLOR: Record<DiaperKind, string> = { wet: 'var(--chart-wet)', both: 'var(--chart-both)', dirty: 'var(--chart-dirty)' }
const KINDS: DiaperKind[] = ['wet', 'dirty', 'both']
const AXIS = [0, 6, 12, 18]

/** The marker for a diaper: a circle for wet, a square for dirty, a diamond for both, so colour is never the only cue. */
function Mark({ kind, className, style }: { kind: DiaperKind; className?: string; style?: React.CSSProperties }) {
  return (
    <span
      data-kind={kind}
      aria-hidden="true"
      className={cn('absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 ring-2 ring-surface', kind === 'wet' && 'rounded-full', kind === 'dirty' && 'rounded-[3px]', kind === 'both' && 'rotate-45 rounded-[2px]', className)}
      style={{ background: COLOR[kind], ...style }}
    />
  )
}

/** Seven days as strips from midnight to midnight, a mark for every change: when they happen, and the gaps between. */
export default function DiaperStrips({ diapers, day, nowMs }: { diapers: Diaper[]; day: Date; nowMs: number }) {
  const { t } = useTranslation()
  const strips = diaperStrips(diapers, day)
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const nowMinute = (nowMs - start) / 60_000
  const showNow = nowMinute >= 0 && nowMinute < 1440
  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {strips.map((s, i) => {
          const chosen = i === 6
          const label = chosen && showNow ? t('timeline.today') : s.day.toLocaleDateString([], { weekday: 'short', day: 'numeric' })
          return (
            <div
              key={s.day.toISOString()}
              data-strip={i}
              role="img"
              aria-current={chosen ? 'date' : undefined}
              aria-label={t('diapers.stripLabel', { day: s.day.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' }), wet: s.wet, dirty: s.dirty })}
              className="flex items-center gap-2"
            >
              <span className={cn('w-14 shrink-0 text-xs', chosen ? 'font-bold text-ink' : 'text-muted')}>{label}</span>
              <span className="relative h-6 flex-1 rounded-full bg-line/60">
                {chosen && showNow && (
                  <span data-testid="strip-now" className="absolute inset-y-0 w-0.5 bg-ink/60" style={{ left: `${(nowMinute / 1440) * 100}%` }} />
                )}
                {s.dots.map((d) => (
                  <Mark key={d.id} kind={d.kind} style={{ left: `${(d.minute / 1440) * 100}%` }} />
                ))}
              </span>
            </div>
          )
        })}
      </div>
      <div aria-hidden="true" className="relative ml-16 h-4 text-[10px] text-muted">
        {AXIS.map((h) => (
          <span key={h} className="absolute -translate-x-1/2" style={{ left: `${(h / 24) * 100}%` }}>
            {formatHour(h)}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
        {KINDS.map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="relative inline-block size-3">
              <Mark kind={k} className="left-1/2 ring-0" />
            </span>
            {t(`diaperKinds.${k}`)}
          </span>
        ))}
      </div>
    </div>
  )
}
