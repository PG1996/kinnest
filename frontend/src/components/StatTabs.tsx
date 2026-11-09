import { useRef, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Vital } from '../api/hooks'
import { cn } from '../lib/cn'
import { MEASUREMENTS, shownUnit, shownValue, type MeasurementKey } from '../lib/vitals'
import { formatValue } from '../lib/vitalsFormat'
import { Sparkline } from './ui/sparkline'

const TREND_POINTS = 10

/** One measurement's readings, oldest first. */
function series(vitals: Vital[], key: MeasurementKey): number[] {
  return vitals
    .filter((v) => v[key] != null)
    .sort((a, b) => Date.parse(a.measured_at) - Date.parse(b.measured_at))
    .map((v) => v[key] as number)
}

/**
 * The vitals metrics as stat cards (after easyui's Stat Card): all visible at once, three on the first row and two on
 * the second, each with the latest value, the change since the reading before, and a small trend line. Choosing a
 * card puts its chart first. A tablist, so arrow keys move between cards.
 */
export default function StatTabs<K extends MeasurementKey>({
  keys,
  vitals,
  value,
  onChange,
}: {
  keys: readonly K[]
  vitals: Vital[]
  value: K
  onChange: (k: K) => void
}) {
  const { t } = useTranslation()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const index = Math.max(0, keys.indexOf(value))
  const move = (e: KeyboardEvent, to: number) => {
    e.preventDefault()
    const next = (to + keys.length) % keys.length
    onChange(keys[next]!)
    refs.current[next]?.focus()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(e, index + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(e, index - 1)
  }

  return (
    <div role="tablist" aria-label={t('vitals.charts.metrics')} onKeyDown={onKeyDown} className="grid grid-cols-6 gap-2">
      {keys.map((k, i) => {
        const m = MEASUREMENTS.find((x) => x.key === k)!
        const all = series(vitals, k)
        const latest = all.at(-1)
        const prev = all.at(-2)
        const step = 10 ** -m.decimals
        const diff = latest != null && prev != null ? Math.round((shownValue(k, latest) - shownValue(k, prev)) / step) * step : null
        const selected = k === value
        return (
          <button
            key={k}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(k)}
            className={cn(
              'min-w-0 space-y-1 rounded-tile border-2 bg-surface p-2.5 text-left transition-colors',
              i < 3 ? 'col-span-2' : 'col-span-3',
              selected ? 'border-primary' : 'border-transparent',
            )}
          >
            <span data-testid="stat-name" className="block truncate text-[11px] font-semibold text-muted">
              {t(m.label)}
            </span>
            <span data-testid="stat-value" className="block truncate text-base font-bold tabular-nums">
              {latest != null ? formatValue(t, k, latest) : '–'}
            </span>
            <span className="flex items-center justify-between gap-1">
              {diff !== null ? (
                <span data-testid="stat-delta" className="truncate rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted">
                  {diff === 0 ? t('vitals.charts.noChange') : `${diff > 0 ? '▲' : '▼'} ${Number(Math.abs(diff).toFixed(m.decimals))} ${t(shownUnit(m))}`}
                </span>
              ) : (
                <span />
              )}
              {all.length > 1 && (
                <span aria-hidden="true" className="shrink-0">
                  <Sparkline values={all.slice(-TREND_POINTS).map((v) => shownValue(k, v))} label="" width={40} height={18} className="text-primary" />
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
