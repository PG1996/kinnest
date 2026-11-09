import { Minus, Plus } from 'lucide-react'

const round = (n: number) => Math.round(n * 10_000) / 10_000

/** A big − / value / + control. Buttons disable at the bounds. */
export function Stepper({
  value,
  step,
  min,
  max,
  unit,
  label,
  onChange,
  format = String,
}: {
  value: number
  step: number
  min: number
  max: number
  unit: string
  label: string
  onChange: (v: number) => void
  format?: (v: number) => string
}) {
  const btn = 'flex size-14 items-center justify-center rounded-full bg-surface-2 text-ink active:scale-95 disabled:opacity-40'
  return (
    <div className="flex items-center justify-between">
      <button type="button" className={btn} disabled={value <= min} aria-label={`${label} −${step} ${unit}`} onClick={() => onChange(Math.max(min, round(value - step)))}>
        <Minus size={24} />
      </button>
      <p className="flex items-baseline gap-1.5">
        <output aria-label={label} className="text-5xl font-extrabold tabular-nums">
          {format(value)}
        </output>
        <span className="text-xl font-bold text-muted">{unit}</span>
      </p>
      <button type="button" className={btn} disabled={value >= max} aria-label={`${label} +${step} ${unit}`} onClick={() => onChange(Math.min(max, round(value + step)))}>
        <Plus size={24} />
      </button>
    </div>
  )
}
