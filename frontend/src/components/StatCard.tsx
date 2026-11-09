import { ArrowDown, ArrowUp } from 'lucide-react'
import { Sparkline } from './ui/sparkline'
import { Card } from './ui/card'

/** One weekly number with its trend line and, when last week has data, the change since then. */
export default function StatCard({
  label,
  value,
  series,
  seriesLabel,
  delta,
}: {
  label: string
  value: string
  series: number[]
  seriesLabel: string
  delta: { up: boolean; text: string } | null
}) {
  return (
    <Card className="flex flex-col gap-1 p-3">
      <div className="text-xs font-bold text-muted">{label}</div>
      <p className="text-xl font-extrabold tabular-nums">{value}</p>
      <Sparkline values={series} label={seriesLabel} width={86} height={24} className="text-primary" />
      {delta && (
        <span className="flex items-center gap-0.5 self-start rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] font-extrabold text-med-ink">
          {delta.up ? <ArrowUp size={10} aria-hidden="true" /> : <ArrowDown size={10} aria-hidden="true" />}
          {delta.text}
        </span>
      )}
    </Card>
  )
}
