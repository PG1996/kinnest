import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { addDays, dragOffset, lockAxis, swipeResult, useStripRange, type Turn } from '../lib/dayPager'
import { cn } from '../lib/cn'
import { prefersReducedMotion } from '../lib/motion'
import { toLocalDate } from '../lib/time'
import { IconButton } from './ui/button'
import type { Tone } from './ui/card'

const EDGE_PX = 20 // swipes starting this close to the screen edge are the browser's (back and forward)
const OUT_MS = 160
const IN_MS = 220
const CHIP_PX = 44
const GAP_PX = 4

const PILL: Partial<Record<Tone, string>> = { feed: 'bg-feed', diaper: 'bg-diaper', sleep: 'bg-sleep' }
const DOT: Partial<Record<Tone, string>> = { feed: 'bg-feed', diaper: 'bg-diaper', sleep: 'bg-sleep' }

const dayName = (d: Date) => d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })

/**
 * Moving between days: arrows and a tappable date, a strip of the last three weeks (a dot on days with entries), and the
 * day's content, which follows a sideways swipe: left for the next day, right for the one before. The days either side are
 * loaded ahead through `onPrefetch`. Swipes starting on anything marked `data-no-swipe` belong to that thing.
 */
export default function DayPager({
  day,
  today,
  onDay,
  tone,
  prevLabel,
  nextLabel,
  marked,
  onPrefetch,
  children,
}: {
  day: Date
  today: Date
  onDay: (d: Date) => void
  tone: Tone
  prevLabel: string
  nextLabel: string
  marked: Set<string>
  onPrefetch?: (d: Date) => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const { days } = useStripRange(day, today.getTime())
  const canNext = day.getTime() < today.getTime()
  const isToday = day.getTime() === today.getTime()
  const [pos, setPos] = useState({ x: 0, ms: 0 })
  const area = useRef<HTMLDivElement>(null)
  const stripEl = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; t: number; id: number; axis: 'x' | 'y' | null } | null>(null)
  const dragged = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const prefetch = useRef(onPrefetch)
  useEffect(() => {
    prefetch.current = onPrefetch
  })
  const selected = days.findIndex((d) => d.getTime() === day.getTime())

  useEffect(() => () => clearTimeout(timer.current), [])

  // load the neighbours so a swipe shows them at once
  useEffect(() => {
    prefetch.current?.(addDays(day, -1))
    if (day.getTime() < today.getTime()) prefetch.current?.(addDays(day, 1))
  }, [day, today])

  // keep the chosen day in the middle of the strip
  const firstScroll = useRef(true)
  useEffect(() => {
    const el = stripEl.current
    if (!el || selected < 0 || typeof el.scrollTo !== 'function') return
    const left = selected * (CHIP_PX + GAP_PX) - el.clientWidth / 2 + CHIP_PX / 2
    el.scrollTo({ left, behavior: firstScroll.current || prefersReducedMotion() ? 'auto' : 'smooth' })
    firstScroll.current = false
  }, [selected])

  const width = () => area.current?.clientWidth || window.innerWidth

  /** Show `target`: the day slides out the way it is going and the new one slides in after it. */
  const show = (target: Date) => {
    if (target.getTime() > today.getTime() || target.getTime() === day.getTime()) return setPos({ x: 0, ms: IN_MS })
    const dir: Turn = target.getTime() > day.getTime() ? 'next' : 'prev'
    clearTimeout(timer.current)
    if (prefersReducedMotion()) {
      setPos({ x: 0, ms: 0 })
      return onDay(target)
    }
    const out = dir === 'next' ? -width() : width()
    setPos({ x: out, ms: OUT_MS })
    timer.current = setTimeout(() => {
      onDay(target)
      setPos({ x: -out * 0.3, ms: 0 })
      requestAnimationFrame(() => requestAnimationFrame(() => setPos({ x: 0, ms: IN_MS })))
    }, OUT_MS)
  }
  const turn = (dir: Turn) => show(addDays(day, dir === 'next' ? 1 : -1))

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragged.current = false
    drag.current = null
    if (e.pointerType === 'mouse') return
    if ((e.target as Element).closest?.('[data-no-swipe]')) return
    if (e.clientX < EDGE_PX || e.clientX > window.innerWidth - EDGE_PX) return
    drag.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId, axis: null }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    const dx = e.clientX - d.x
    if (!d.axis) {
      d.axis = lockAxis(dx, e.clientY - d.y)
      if (d.axis === 'y') return void (drag.current = null)
      if (!d.axis) return
      dragged.current = true
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // the pointer is already gone
      }
    }
    setPos({ x: dragOffset(dx, canNext), ms: 0 })
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (!d || d.axis !== 'x') return
    const dir = swipeResult(e.clientX - d.x, e.timeStamp - d.t, width(), canNext)
    if (dir) turn(dir)
    else setPos({ x: 0, ms: IN_MS })
  }
  const onPointerCancel = () => {
    if (drag.current?.axis === 'x') setPos({ x: 0, ms: IN_MS })
    drag.current = null
  }

  const pick = (value: string) => {
    const [y, m, d] = value.split('-').map(Number)
    if (!y || !m || !d) return
    const target = new Date(y, m - 1, d)
    show(target.getTime() > today.getTime() ? today : target)
  }

  const fade = 1 - Math.min(Math.abs(pos.x) / window.innerWidth, 1) * 0.6

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <IconButton label={prevLabel} onClick={() => turn('prev')}>
            <ChevronLeft size={20} aria-hidden="true" />
          </IconButton>
          <span className="relative flex items-center gap-1.5 font-semibold">
            <CalendarDays size={16} aria-hidden="true" className="text-muted" />
            <span data-testid="day-label">{isToday ? t('timeline.today') : dayName(day)}</span>
            <input
              type="date"
              aria-label={t('dayPager.pick')}
              value={toLocalDate(day)}
              max={toLocalDate(today)}
              onChange={(e) => pick(e.target.value)}
              onClick={(e) => {
                try {
                  e.currentTarget.showPicker?.()
                } catch {
                  // the browser opens it itself, or cannot
                }
              }}
              className="absolute inset-0 w-full cursor-pointer opacity-0"
            />
          </span>
          <IconButton label={nextLabel} onClick={() => turn('next')} disabled={!canNext} className="disabled:opacity-40">
            <ChevronRight size={20} aria-hidden="true" />
          </IconButton>
        </div>
        <div ref={stripEl} role="group" aria-label={t('dayPager.strip')} className="-mx-4 snap-x overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="relative flex w-max gap-1">
            {selected >= 0 && (
              <span
                aria-hidden="true"
                className={cn('absolute top-0 left-0 h-full rounded-2xl transition-transform duration-300 ease-out motion-reduce:transition-none', PILL[tone])}
                style={{ width: CHIP_PX, transform: `translateX(${selected * (CHIP_PX + GAP_PX)}px)` }}
              />
            )}
            {days.map((d, i) => {
              const on = i === selected
              const hasEntries = marked.has(toLocalDate(d))
              return (
                <button
                  key={d.getTime()}
                  type="button"
                  aria-pressed={on}
                  aria-label={hasEntries ? `${dayName(d)}, ${t('dayPager.logged')}` : dayName(d)}
                  onClick={() => show(d)}
                  className={cn(
                    'relative flex h-14 shrink-0 snap-center flex-col items-center justify-center gap-0.5 rounded-2xl text-xs font-semibold',
                    on ? 'text-primary-ink' : 'text-ink',
                  )}
                  style={{ width: CHIP_PX }}
                >
                  <span className={on ? '' : 'text-muted'}>{d.toLocaleDateString([], { weekday: 'narrow' })}</span>
                  <span className="text-base leading-none font-bold tabular-nums">{d.getDate()}</span>
                  <span className={cn('size-1.5 rounded-full', hasEntries ? (on ? 'bg-current' : DOT[tone]) : 'bg-transparent')} />
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <div className="-mx-4 overflow-x-clip px-4">
        <div
          ref={area}
          data-testid="day-swipe"
          className="touch-pan-y space-y-4"
          style={{
            transform: pos.x ? `translateX(${pos.x}px)` : undefined,
            opacity: fade < 1 ? fade : undefined,
            transition: pos.ms ? `transform ${pos.ms}ms ease-out, opacity ${pos.ms}ms ease-out` : undefined,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onClickCapture={(e) => {
            // a drag that ends over a row must not open it
            if (!dragged.current) return
            dragged.current = false
            e.preventDefault()
            e.stopPropagation()
          }}
        >
          {children}
        </div>
      </div>
    </>
  )
}
