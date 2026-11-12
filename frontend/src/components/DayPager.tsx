import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { addDays, dragOffset, lockAxis, swipeResult, useStripRange, type Turn } from '../lib/dayPager'
import { prefersReducedMotion } from '../lib/motion'
import { toLocalDate } from '../lib/time'
import DayStrip, { type StripTone } from './DayStrip'
import { IconButton } from './ui/button'
import { DateSheet } from './ui/datetime'
import type { Tone } from './ui/card'

const EDGE_PX = 20 // swipes starting this close to the screen edge are the browser's (back and forward)
const OUT_MS = 160
const IN_MS = 220


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
  marks,
  describe,
  stripClassName,
  onPrefetch,
  children,
}: {
  day: Date
  today: Date
  onDay: (d: Date) => void
  tone: Tone | 'primary'
  prevLabel: string
  nextLabel: string
  /** days with entries get one dot in the page's colour */
  marked?: Set<string>
  /** or the page names the dots (one per kind) and the words for each day itself */
  marks?: (d: Date) => StripTone[]
  describe?: (d: Date) => string
  /** classes for the strip's wrapper, e.g. to hide it on a phone turned sideways */
  stripClassName?: string
  onPrefetch?: (d: Date) => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const { days } = useStripRange(day, today.getTime())
  const canNext = day.getTime() < today.getTime()
  const isToday = day.getTime() === today.getTime()
  const [pos, setPos] = useState({ x: 0, ms: 0 })
  const [picking, setPicking] = useState(false)
  const area = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; t: number; id: number; axis: 'x' | 'y' | null } | null>(null)
  const dragged = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const prefetch = useRef(onPrefetch)
  useEffect(() => {
    prefetch.current = onPrefetch
  })

  useEffect(() => () => clearTimeout(timer.current), [])

  // load the neighbours so a swipe shows them at once
  useEffect(() => {
    prefetch.current?.(addDays(day, -1))
    if (day.getTime() < today.getTime()) prefetch.current?.(addDays(day, 1))
  }, [day, today])


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


  const fade = 1 - Math.min(Math.abs(pos.x) / window.innerWidth, 1) * 0.6

  return (
    <>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <IconButton label={prevLabel} onClick={() => turn('prev')}>
            <ChevronLeft size={20} aria-hidden="true" />
          </IconButton>
          <button type="button" aria-label={t('dayPager.pick')} onClick={() => setPicking(true)} className="flex min-h-11 items-center gap-1.5 rounded-full px-3 font-semibold">
            <CalendarDays size={16} aria-hidden="true" className="text-muted" />
            <span data-testid="day-label">{isToday ? t('timeline.today') : dayName(day)}</span>
          </button>
          <IconButton label={nextLabel} onClick={() => turn('next')} disabled={!canNext} className="disabled:opacity-40">
            <ChevronRight size={20} aria-hidden="true" />
          </IconButton>
        </div>
        <div className={stripClassName}>
          <DayStrip
            days={days}
            selected={day}
            onPick={show}
            tone={tone as StripTone}
            marks={marks ?? ((d) => (marked?.has(toLocalDate(d)) ? [tone as StripTone] : []))}
            describe={describe ?? ((d) => (marked?.has(toLocalDate(d)) ? t('dayPager.logged') : ''))}
          />
        </div>
      </div>
      {picking &&
        createPortal(
          <DateSheet
            label={t('dayPager.pick')}
            initial={day}
            onClose={() => setPicking(false)}
            onDone={(d) => {
              setPicking(false)
              show(d.getTime() > today.getTime() ? today : d)
            }}
          />,
          document.body,
        )}
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
