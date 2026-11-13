import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { addMonths, addYears, monthCells, monthOf, neighbours, yearMonths, type MarkKind, type Month } from '../lib/calendar'
import { cn } from '../lib/cn'
import { toLocalDate } from '../lib/time'

/**
 * A month (or year) calendar of the days something was logged, for the Vitals, Vaccines and Visits tabs. Each day shows
 * marks the tab draws; tapping a day picks it (tapping it again lets go). Swipe or the arrows move a month; the two jump
 * buttons go straight to the nearest day with an entry, skipping empty months.
 */

const asDate = (day: string) => new Date(`${day}T00:00:00`)
const longDay = (day: string) => asDate(day).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
const shortDay = (day: string, year: string) =>
  asDate(day).toLocaleDateString([], { day: 'numeric', month: 'short', ...(day.slice(0, 4) !== year ? { year: 'numeric' } : {}) })
const monthTitle = (m: Month) => asDate(`${m}-01`).toLocaleDateString([], { month: 'long', year: 'numeric' })
const monthShort = (m: Month) => asDate(`${m}-01`).toLocaleDateString([], { month: 'short' })
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Date(2026, 0, 4 + i).toLocaleDateString([], { weekday: 'narrow' })) // 4 Jan 2026 is a Sunday

export type CalendarProps<T> = {
  /** names the calendar for screen readers, e.g. "Vitals calendar" */
  label: string
  /** entries by local day "YYYY-MM-DD" */
  days: Map<string, T[]>
  month: Month
  onMonth: (m: Month) => void
  selected: string | null
  onSelect: (day: string | null) => void
  range: { min: Month; max: Month }
  /** the day of birth: empty days before it are left blank */
  firstDay?: string | null
  /** what a day with entries shows under its number */
  marks: (list: T[]) => ReactNode
  /** the entries of a day in words, for its accessible name */
  describe: (list: T[]) => string
  /** the colour of a day in the year view */
  mini: (list: T[]) => string
  /** days to tint amber (a fever, say) */
  warn?: (list: T[]) => boolean
  /** "3 days with readings" */
  summary: (count: number) => string
  /** filters, shown under the header */
  children?: ReactNode
}

export default function HistoryCalendar<T>({
  label,
  days,
  month,
  onMonth,
  selected,
  onSelect,
  range,
  firstDay,
  marks,
  describe,
  mini,
  warn,
  summary,
  children,
}: CalendarProps<T>) {
  const { t } = useTranslation()
  const [view, setView] = useState<'month' | 'year'>('month')
  const [slide, setSlide] = useState<{ dir: 'l' | 'r'; n: number } | null>(null)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const swiped = useRef(false)
  const [today] = useState(() => toLocalDate(new Date()))
  const year = month.slice(0, 4)
  const isMonth = view === 'month'

  const canMove = (n: number) => {
    if (isMonth) {
      const to = addMonths(month, n)
      return to >= range.min && to <= range.max
    }
    const y = String(Number(year) + n)
    return y >= range.min.slice(0, 4) && y <= range.max.slice(0, 4)
  }
  const move = (n: number) => {
    if (!canMove(n)) return
    let to = isMonth ? addMonths(month, n) : addYears(month, n)
    if (to < range.min) to = range.min
    if (to > range.max) to = range.max
    setSlide({ dir: n > 0 ? 'l' : 'r', n: (slide?.n ?? 0) + 1 })
    onSelect(null)
    onMonth(to)
  }
  const jump = (day: string) => {
    setSlide({ dir: day > month ? 'l' : 'r', n: (slide?.n ?? 0) + 1 })
    onMonth(monthOf(day))
    onSelect(day)
  }

  const swipeHandlers = {
    onPointerDown: (e: PointerEvent) => {
      swipe.current = { x: e.clientX, y: e.clientY }
      swiped.current = false
    },
    onPointerUp: (e: PointerEvent) => {
      const s = swipe.current
      swipe.current = null
      if (!s) return
      const dx = e.clientX - s.x
      const dy = e.clientY - s.y
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        swiped.current = true
        move(dx < 0 ? 1 : -1)
      }
    },
    onPointerCancel: () => {
      swipe.current = null
    },
    // the tap that ends a swipe does not also pick a day
    onClickCapture: (e: MouseEvent) => {
      if (swiped.current) {
        swiped.current = false
        e.stopPropagation()
        e.preventDefault()
      }
    },
  }

  const inMonth = [...days.keys()].filter((d) => monthOf(d) === month).length
  const { before, after } = neighbours(days.keys(), month)
  const anim = slide ? (slide.dir === 'l' ? 'animate-[cal-in-l_200ms_ease-out]' : 'animate-[cal-in-r_200ms_ease-out]') : ''

  return (
    <section aria-label={label} className="space-y-2.5 overflow-hidden rounded-card border border-line bg-surface p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            aria-label={t(isMonth ? 'calendar.prevMonth' : 'calendar.prevYear')}
            disabled={!canMove(-1)}
            onClick={() => move(-1)}
            className="grid size-9 flex-none place-items-center rounded-full bg-surface-2 disabled:opacity-35"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <span aria-live="polite" className="min-w-[7.5em] text-center font-bold tabular-nums">
            {isMonth ? monthTitle(month) : year}
          </span>
          <button
            type="button"
            aria-label={t(isMonth ? 'calendar.nextMonth' : 'calendar.nextYear')}
            disabled={!canMove(1)}
            onClick={() => move(1)}
            className="grid size-9 flex-none place-items-center rounded-full bg-surface-2 disabled:opacity-35"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
        <div role="group" aria-label={t('calendar.size')} className="flex flex-none gap-0.5 rounded-full bg-surface-2 p-0.5">
          {(['month', 'year'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => {
                setView(v)
                setSlide(null)
              }}
              className={cn('h-8 rounded-full px-3 text-xs font-bold', view === v ? 'bg-primary text-primary-ink' : 'text-muted')}
            >
              {t(`calendar.${v}`)}
            </button>
          ))}
        </div>
      </div>
      {children}
      <div data-testid="calendar-stage" className="touch-pan-y overflow-hidden" {...swipeHandlers}>
        <div key={`${view}-${month}-${slide?.n ?? 0}`} className={cn('motion-reduce:animate-none', anim)}>
          {isMonth ? (
            <div role="group" aria-label={monthTitle(month)} className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((w, i) => (
                <span key={`w${i}`} aria-hidden="true" className="pb-0.5 text-center text-[11px] font-bold text-muted">
                  {w}
                </span>
              ))}
              {monthCells(month).map((day, i) => {
                if (!day || monthOf(day) < range.min || (firstDay && day < firstDay && !days.has(day))) return <span key={`b${i}`} aria-hidden="true" />
                const list = days.get(day)
                const on = selected === day
                const hot = !!list && !!warn?.(list)
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${longDay(day)}${day === today ? `, ${t('calendar.today')}` : ''}: ${list ? describe(list) : t('calendar.nothing')}`}
                    onClick={() => onSelect(on ? null : day)}
                    className={cn(
                      'flex h-13 min-w-0 flex-col items-center justify-between rounded-xl border-2 border-transparent pt-1 pb-0.5',
                      list && 'bg-surface-2',
                      hot && 'border-warn-solid/50 bg-warn-bg',
                      on && 'border-primary bg-primary-soft',
                    )}
                  >
                    <span
                      className={cn(
                        'grid h-[22px] min-w-6 place-items-center rounded-full px-1 text-[13px] tabular-nums',
                        list ? 'font-bold text-ink' : 'font-semibold text-muted',
                        day > today && !list && 'opacity-55',
                        day === today && 'bg-primary text-primary-ink',
                      )}
                    >
                      {Number(day.slice(8))}
                    </span>
                    <span
                      aria-hidden="true"
                      className="flex h-3 items-center justify-center gap-0.5 text-[10px] font-bold whitespace-nowrap text-muted tabular-nums"
                    >
                      {list && marks(list)}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-x-2 gap-y-2.5">
              {yearMonths(month).map((m) => {
                const off = m < range.min || m > range.max
                const cells = monthCells(m)
                const count = cells.filter((d) => d && days.has(d)).length
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={off}
                    aria-label={`${monthTitle(m)}: ${summary(count)}`}
                    onClick={() => {
                      onSelect(null)
                      onMonth(m)
                      setView('month')
                      setSlide(null)
                    }}
                    className={cn(
                      'flex min-w-0 flex-col gap-1 rounded-xl border-2 border-transparent p-1 text-left disabled:opacity-35',
                      m === month && 'border-primary',
                    )}
                  >
                    <span className="flex justify-between px-0.5 text-xs font-bold">
                      {monthShort(m)}
                      <span className="text-muted tabular-nums">{count || ''}</span>
                    </span>
                    <span aria-hidden="true" className="grid grid-cols-7 gap-0.5">
                      {cells.map((d, i) => {
                        const list = d ? days.get(d) : undefined
                        const style: CSSProperties | undefined = list ? { background: warn?.(list) ? 'var(--warn-solid)' : mini(list) } : undefined
                        return (
                          <i
                            key={i}
                            style={style}
                            className={cn(
                              'aspect-square rounded-[2px]',
                              d ? 'bg-surface-2' : 'bg-transparent',
                              d === today && 'outline-[1.5px] -outline-offset-1 outline-primary outline-solid',
                            )}
                          />
                        )
                      })}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
      {isMonth ? (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
          <span className="justify-self-start">
            {before && (
              <button
                type="button"
                aria-label={t('calendar.earlier', { date: longDay(before) })}
                onClick={() => jump(before)}
                className="min-h-8 rounded-full bg-surface-2 px-2.5 text-xs font-bold whitespace-nowrap"
              >
                ‹ {shortDay(before, year)}
              </button>
            )}
          </span>
          <span className="text-center text-xs font-semibold text-muted tabular-nums">{inMonth ? summary(inMonth) : t('calendar.nothingMonth')}</span>
          <span className="justify-self-end">
            {after && (
              <button
                type="button"
                aria-label={t('calendar.later', { date: longDay(after) })}
                onClick={() => jump(after)}
                className="min-h-8 rounded-full bg-surface-2 px-2.5 text-xs font-bold whitespace-nowrap"
              >
                {shortDay(after, year)} ›
              </button>
            )}
          </span>
        </div>
      ) : (
        <p className="text-center text-xs text-muted">{t('calendar.tapMonth')}</p>
      )}
    </section>
  )
}

/** The heading over a picked day's entries, with a way back to all of them. */
export function PickedDay({ day, count, onClear }: { day: string; count: string; onClear: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-9 items-center justify-between gap-2 px-1">
      <h3 className="font-bold">{longDay(day)}</h3>
      <span className="flex items-center gap-2 text-sm font-semibold text-muted">
        {count}
        <button type="button" onClick={onClear} className="min-h-8 rounded-full border border-line bg-surface px-3 text-xs font-bold text-ink">
          {t('calendar.showAll')}
        </button>
      </span>
    </div>
  )
}

/** A status drawn as a shape, so it does not rest on colour alone: filled is done, a ring is still to come, crossed is skipped. */
export function StatusMark({ kind, className = 'size-[11px]' }: { kind: MarkKind; className?: string }) {
  const crossed = kind === 'skipped' || kind === 'cancelled'
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className={cn('flex-none', className)}>
      {kind === 'given' && (
        <>
          <circle cx="6" cy="6" r="5.6" style={{ fill: 'var(--diaper)' }} />
          <path d="M3.3 6.2l1.9 1.9 3.5-3.7" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ stroke: 'var(--surface)' }} />
        </>
      )}
      {kind === 'overdue' && (
        <>
          <circle cx="6" cy="6" r="5.6" style={{ fill: 'var(--warn-solid)' }} />
          <path d="M6 3v3.6" strokeWidth="1.8" strokeLinecap="round" style={{ stroke: 'var(--warn-solid-ink)' }} />
          <circle cx="6" cy="8.9" r="1" style={{ fill: 'var(--warn-solid-ink)' }} />
        </>
      )}
      {kind === 'done' && <circle cx="6" cy="6" r="5.4" style={{ fill: 'var(--sleep)' }} />}
      {(kind === 'due' || kind === 'upcoming') && (
        <circle cx="6" cy="6" r="4.6" strokeWidth="1.8" style={{ fill: 'var(--surface)', stroke: kind === 'due' ? 'var(--primary)' : 'var(--sleep)' }} />
      )}
      {crossed && (
        <>
          <circle cx="6" cy="6" r="4.6" fill="none" strokeWidth="1.6" style={{ stroke: 'var(--muted)' }} />
          <path d="M2.8 9.2l6.4-6.4" strokeWidth="1.6" strokeLinecap="round" style={{ stroke: 'var(--muted)' }} />
        </>
      )}
    </svg>
  )
}
