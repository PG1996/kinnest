import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn'
import { prefersReducedMotion } from '../lib/motion'

export type StripTone = 'feed' | 'diaper' | 'sleep' | 'med' | 'primary'

const CHIP_PX = 44
const GAP_PX = 4
const BG: Record<StripTone, string> = { feed: 'bg-feed', diaper: 'bg-diaper', sleep: 'bg-sleep', med: 'bg-med', primary: 'bg-primary' }

const dayName = (d: Date) => d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })

/**
 * A row of days that scrolls sideways, the chosen one under a pill that glides to it and kept in the middle. Each day can
 * carry dots (`marks`, one colour per kind logged) and a few words for screen readers (`describe`).
 */
export default function DayStrip({
  days,
  selected,
  onPick,
  tone,
  marks,
  describe,
}: {
  days: Date[]
  selected: Date
  onPick: (d: Date) => void
  /** the pill's colour */
  tone: StripTone
  marks: (d: Date) => StripTone[]
  describe?: (d: Date) => string
}) {
  const { t } = useTranslation()
  const el = useRef<HTMLDivElement>(null)
  const index = days.findIndex((d) => d.getTime() === selected.getTime())

  // keep the chosen day in the middle of the strip
  const first = useRef(true)
  useEffect(() => {
    const strip = el.current
    if (!strip || index < 0 || typeof strip.scrollTo !== 'function') return
    const left = index * (CHIP_PX + GAP_PX) - strip.clientWidth / 2 + CHIP_PX / 2
    strip.scrollTo({ left, behavior: first.current || prefersReducedMotion() ? 'auto' : 'smooth' })
    first.current = false
  }, [index])

  return (
    <div ref={el} role="group" aria-label={t('dayPager.strip')} className="-mx-4 snap-x overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="relative flex w-max gap-1">
        {index >= 0 && (
          <span
            aria-hidden="true"
            className={cn('absolute top-0 left-0 h-full rounded-2xl transition-transform duration-300 ease-out motion-reduce:transition-none', BG[tone])}
            style={{ width: CHIP_PX, transform: `translateX(${index * (CHIP_PX + GAP_PX)}px)` }}
          />
        )}
        {days.map((d, i) => {
          const on = i === index
          const dots = marks(d)
          const words = describe?.(d)
          return (
            <button
              key={d.getTime()}
              type="button"
              aria-pressed={on}
              aria-label={words ? `${dayName(d)}, ${words}` : dayName(d)}
              onClick={() => onPick(d)}
              className={cn('relative flex h-14 shrink-0 snap-center flex-col items-center justify-center gap-0.5 rounded-2xl text-xs font-semibold', on ? 'text-primary-ink' : 'text-ink')}
              style={{ width: CHIP_PX }}
            >
              <span className={on ? '' : 'text-muted'}>{d.toLocaleDateString([], { weekday: 'narrow' })}</span>
              <span className="text-base leading-none font-bold tabular-nums">{d.getDate()}</span>
              <span aria-hidden="true" className="flex h-1.5 gap-0.5">
                {dots.map((tn) => (
                  <span key={tn} className={cn('size-1.5 rounded-full', on ? 'bg-current' : BG[tn])} />
                ))}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
