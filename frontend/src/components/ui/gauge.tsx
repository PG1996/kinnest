import type { ReactNode } from 'react'

const R = 52
const ARC = Math.PI * R

/** A half-ring that fills from 0 to 1 with a centre readout. */
export function HalfGauge({
  fraction,
  label,
  tone = 'feed',
  children,
}: {
  fraction: number
  label: string
  tone?: 'feed' | 'diaper' | 'sleep' | 'med'
  children?: ReactNode
}) {
  const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0))
  const color = `var(--${tone})`
  return (
    <div className="relative h-[76px] w-[124px] shrink-0">
      <svg role="img" aria-label={label} width="124" height="76" viewBox="0 0 124 76">
        <path d="M10,68 A52,52 0 0 1 114,68" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="12" strokeLinecap="round" />
        <path
          d="M10,68 A52,52 0 0 1 114,68"
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={ARC}
          strokeDashoffset={ARC * (1 - f)}
          style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(.2,.9,.3,1)' }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center leading-tight">{children}</div>
    </div>
  )
}
