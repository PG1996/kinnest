import { useId } from 'react'

/** A tiny trend line with a soft area under it and a dot on the last value. */
export function Sparkline({
  values,
  label,
  width = 84,
  height = 34,
  className = 'text-diaper',
}: {
  values: number[]
  label: string
  width?: number
  height?: number
  className?: string
}) {
  const id = useId()
  const pad = 4
  if (values.length === 0) return <svg role="img" aria-label={label} width={width} height={height} />
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  const pts = values.map((v, i) => [
    pad + (values.length === 1 ? (width - 2 * pad) / 2 : (i * (width - 2 * pad)) / (values.length - 1)),
    height - pad - ((v - lo) / span) * (height - 2 * pad),
  ])
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x!.toFixed(1)},${y!.toFixed(1)}`).join('')
  const last = pts[pts.length - 1]!
  return (
    <svg role="img" aria-label={label} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className}>
      <path id={id} d={`${line}L${last[0]},${height}L${pts[0]![0]},${height}Z`} fill="currentColor" opacity="0.14" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill="currentColor" stroke="var(--surface)" strokeWidth="2" />
    </svg>
  )
}

/**
 * Several trend lines on one shared scale from 0 to the highest value, so their heights compare and a zero sits on the
 * bottom edge. Lines only (no area), with a dot on each line's last value.
 */
export function MultiSparkline({
  series,
  label,
  width = 84,
  height = 34,
}: {
  series: { values: number[]; color: string }[]
  label: string
  width?: number
  height?: number
}) {
  const pad = 4
  const n = Math.max(0, ...series.map((s) => s.values.length))
  const hi = Math.max(1, ...series.flatMap((s) => s.values))
  const x = (i: number) => pad + (n <= 1 ? (width - 2 * pad) / 2 : (i * (width - 2 * pad)) / (n - 1))
  const y = (v: number) => height - pad - (v / hi) * (height - 2 * pad)
  return (
    <svg role="img" aria-label={label} width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {series.map((s, k) => {
        if (s.values.length === 0) return null
        const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
        const last = s.values.length - 1
        return (
          <g key={k}>
            <path data-series={k} d={d} fill="none" stroke={s.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={x(last)} cy={y(s.values[last]!)} r="3" fill={s.color} stroke="var(--surface)" strokeWidth="1.5" />
          </g>
        )
      })}
    </svg>
  )
}
