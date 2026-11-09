import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn'
import { formatHour } from '../lib/time'
import { level, type PatternKind } from '../lib/patterns'

const BLOCKS = 12
const hourLabel = formatHour
const range = (b: number) => `${hourLabel(b * 2)}–${hourLabel((b * 2 + 2) % 24)}`

/** Days down, two-hour blocks across. Every cell is a button; selecting one reports it so the page can describe it. */
export default function Heatmap({
  grid,
  days,
  kind,
  now,
  selected,
  describeValue,
  onSelect,
  label,
}: {
  grid: number[][]
  days: Date[]
  kind: PatternKind
  now: Date
  selected: [number, number] | null
  describeValue: (v: number) => string
  onSelect: (row: number, col: number) => void
  label: string
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[2.25rem_repeat(4,minmax(0,1fr))] gap-[3px] text-[11px] font-bold text-muted" aria-hidden="true">
        <span />
        {[0, 6, 12, 18].map((h) => (
          <span key={h}>{hourLabel(h)}</span>
        ))}
      </div>
      <div role="grid" aria-label={label} className="flex flex-col gap-[3px]">
        {days.map((day, row) => {
          const weekday = day.toLocaleDateString([], { weekday: 'short' })
          return (
            <div key={day.toISOString()} role="row" className="grid grid-cols-[2.25rem_repeat(12,minmax(0,1fr))] items-center gap-[3px]">
              <span role="rowheader" className="text-xs font-bold text-muted">
                {weekday}
              </span>
              {grid[row]!.map((v, col) => {
                const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), col * 2).getTime()
                const future = start > now.getTime()
                const isSel = selected?.[0] === row && selected[1] === col
                const text = future ? t('patterns.notYet') : describeValue(v)
                return (
                  <button
                    key={col}
                    type="button"
                    role="gridcell"
                    aria-label={t('patterns.cell', { day: weekday, range: range(col), value: text })}
                    onClick={() => onSelect(row, col)}
                    onMouseEnter={() => onSelect(row, col)}
                    onFocus={() => onSelect(row, col)}
                    className={cn('heat-cell h-[22px] rounded-md p-0', future && 'border border-dashed border-line bg-transparent', isSel && 'ring-2 ring-ink')}
                    style={{
                      background: future ? undefined : `var(--heat-${level(v, kind)})`,
                      animationDelay: `${(row * BLOCKS + col) * 6}ms`,
                    }}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
