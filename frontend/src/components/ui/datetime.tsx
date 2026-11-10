import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'
import { fromInput, toInput, withTime, type Moved, type PickMode } from '../../lib/pickTime'
import { formatAgo, formatTime, toLocalDate } from '../../lib/time'
import { useNow } from '../../lib/useNow'
import Sheet from '../Sheet'
import { Button } from './button'
import { Chip } from './chip'

type T = (key: string, opts?: Record<string, unknown>) => string

const DAY_MS = 86_400_000
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const sameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime()
const nowMinute = () => {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours(), n.getMinutes())
}

/** "Today", "Yesterday", "Tomorrow" or "Sun, 8 Nov". */
function dayWord(d: Date, t: T): string {
  const today = new Date()
  if (sameDay(d, today)) return t('picker.today')
  if (sameDay(d, new Date(today.getTime() - DAY_MS))) return t('picker.yesterday')
  if (sameDay(d, new Date(today.getTime() + DAY_MS))) return t('picker.tomorrow')
  return d.toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

// ---- the time wheels ----

const ITEM_PX = 40
const VISIBLE = 5
const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

/** One wheel: a list that scrolls and snaps; the item in the middle band is the value. Tapping an item picks it too. */
function Wheel({ label, items, selected, onSelect }: { label: string; items: string[]; selected: number; onSelect: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const idPrefix = useId()
  const quiet = useRef(false) // scrolling we did ourselves is not the person choosing
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const current = useRef({ selected, onSelect })
  useEffect(() => {
    current.current = { selected, onSelect }
  })
  useEffect(() => () => clearTimeout(timer.current), [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || Math.round(el.scrollTop / ITEM_PX) === selected) return
    quiet.current = true
    el.scrollTop = selected * ITEM_PX
    requestAnimationFrame(() => {
      quiet.current = false
    })
  }, [selected])

  const settle = () => {
    const el = ref.current
    if (!el) return
    const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_PX)))
    if (i !== current.current.selected) current.current.onSelect(i)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    onSelect(Math.min(items.length - 1, Math.max(0, selected + step)))
  }
  const pad = ((VISIBLE - 1) / 2) * ITEM_PX

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      aria-activedescendant={`${idPrefix}-${selected}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={() => {
        if (quiet.current) return
        clearTimeout(timer.current)
        timer.current = setTimeout(settle, 90)
      }}
      className="relative snap-y snap-mandatory overflow-y-scroll rounded-lg outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-primary/40 [&::-webkit-scrollbar]:hidden"
      style={{
        height: VISIBLE * ITEM_PX,
        maskImage: 'linear-gradient(transparent, #000 30%, #000 70%, transparent)',
        WebkitMaskImage: 'linear-gradient(transparent, #000 30%, #000 70%, transparent)',
      }}
    >
      <div aria-hidden="true" style={{ height: pad }} />
      {items.map((item, i) => (
        <div
          key={item}
          id={`${idPrefix}-${i}`}
          role="option"
          aria-selected={i === selected}
          onClick={() => onSelect(i)}
          className={cn(
            'flex snap-center items-center justify-center text-[1.375rem] tabular-nums select-none',
            i === selected ? 'font-bold text-ink' : 'font-semibold text-muted',
          )}
          style={{ height: ITEM_PX }}
        >
          {item}
        </div>
      ))}
      <div aria-hidden="true" style={{ height: pad }} />
    </div>
  )
}

/** Hour, minute and AM/PM wheels for a 24-hour `hour`. */
export function TimeWheels({ hour, minute, onChange }: { hour: number; minute: number; onChange: (hour: number, minute: number) => void }) {
  const { t } = useTranslation()
  const pm = hour >= 12
  const to24 = (h12: number, isPm: boolean) => (h12 % 12) + (isPm ? 12 : 0)
  return (
    <div className="relative grid grid-cols-[1fr_1fr_0.9fr] gap-1.5 rounded-2xl bg-surface-2 px-2">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-2 rounded-xl bg-surface" style={{ top: 2 * ITEM_PX, height: ITEM_PX }} />
      <Wheel label={t('picker.hour')} items={HOURS} selected={(hour + 11) % 12} onSelect={(i) => onChange(to24(i + 1, pm), minute)} />
      <Wheel label={t('picker.minute')} items={MINUTES} selected={minute} onSelect={(i) => onChange(hour, i)} />
      <Wheel label={t('picker.ampm')} items={['AM', 'PM']} selected={pm ? 1 : 0} onSelect={(i) => onChange(to24(((hour + 11) % 12) + 1, i === 1), minute)} />
    </div>
  )
}

// ---- the month calendar ----

/** A month of days to tap; days after `max` cannot be chosen. */
export function MonthCalendar({ value, onPick, max }: { value: Date | null; onPick: (day: Date) => void; max?: Date }) {
  const { t } = useTranslation()
  const [month, setMonth] = useState(() => {
    const d = value ?? new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  // a day chosen elsewhere (Today, Yesterday) brings its month into view; adjusted while rendering, not in an effect
  const valueMonth = value ? value.getFullYear() * 12 + value.getMonth() : null
  const [followed, setFollowed] = useState(valueMonth)
  if (valueMonth !== followed) {
    setFollowed(valueMonth)
    if (valueMonth !== null) setMonth(new Date(Math.floor(valueMonth / 12), valueMonth % 12, 1))
  }
  const today = startOfDay(new Date())
  const limit = max ? startOfDay(max) : null
  const next = new Date(month.getFullYear(), month.getMonth() + 1, 1)
  const canNext = !limit || next.getTime() <= limit.getTime()
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const lead = month.getDay()
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2026, 0, 4 + i).toLocaleDateString([], { weekday: 'narrow' })) // 4 Jan 2026 is a Sunday
  const title = month.toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="space-y-2 rounded-2xl border border-line p-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label={t('picker.prevMonth')}
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          className="grid size-9 place-items-center rounded-full bg-surface-2"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <span className="font-bold">{title}</span>
        <button
          type="button"
          aria-label={t('picker.nextMonth')}
          disabled={!canNext}
          onClick={() => setMonth(next)}
          className="grid size-9 place-items-center rounded-full bg-surface-2 disabled:opacity-35"
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <div role="group" aria-label={title} className="grid grid-cols-7 gap-0.5 text-center">
        {weekdays.map((w, i) => (
          <span key={i} aria-hidden="true" className="py-1 text-[11px] font-bold text-muted">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const day = new Date(month.getFullYear(), month.getMonth(), i + 1)
          const on = !!value && sameDay(day, value)
          return (
            <button
              key={i}
              type="button"
              aria-pressed={on}
              aria-label={day.toLocaleDateString([], {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
              disabled={!!limit && day.getTime() > limit.getTime()}
              onClick={() => onPick(day)}
              className={cn(
                'aspect-square rounded-full font-semibold tabular-nums disabled:opacity-35',
                on ? 'bg-primary text-primary-ink' : sameDay(day, today) ? 'ring-1 ring-primary ring-inset' : '',
              )}
            >
              {i + 1}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---- the date and time field ----

function DateTimeSheet({
  label,
  initial,
  mode,
  onDone,
  onClear,
  onClose,
}: {
  label: string
  initial: Date
  mode: PickMode
  onDone: (d: Date) => void
  onClear?: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  // the day the person chose and the time on the wheels; the value follows from both, so turning one wheel after
  // another never carries an earlier move to yesterday along
  const [day, setDay] = useState(() => startOfDay(initial))
  const [time, setTime] = useState({
    h: initial.getHours(),
    m: initial.getMinutes(),
  })
  const [calendar, setCalendar] = useState(false)
  useNow() // keeps "2h 10m ago" ticking; the time itself is checked against the real clock, never a stale one
  const now = new Date()
  const { at, moved }: { at: Date; moved: Moved } = withTime(day, time.h, time.m, mode, now)
  const other = new Date(now.getTime() + (mode === 'past' ? -DAY_MS : DAY_MS))
  const isToday = sameDay(at, now)
  const isOther = sameDay(at, other)
  const pickDay = (d: Date) => {
    setDay(startOfDay(d))
    setCalendar(false)
  }
  const diff = at.getTime() - now.getTime()

  return (
    <Sheet title={label} onClose={onClose}>
      <p className="text-[1.75rem] leading-tight font-bold tabular-nums">
        {dayWord(at, t)}, {formatTime(at)}
        <span className="block text-sm font-semibold text-muted">
          {Math.abs(diff) < 60_000 ? t('picker.justNow') : diff < 0 ? t('picker.ago', { ago: formatAgo(-diff) }) : t('picker.in', { ago: formatAgo(diff) })}
        </span>
      </p>
      {moved && (
        <p role="status" className="rounded-xl bg-warn-bg px-3 py-2 text-sm font-semibold text-warn-ink">
          {moved === 'yesterday' ? t('picker.movedYesterday', { time: formatTime(at) }) : t('picker.movedNow')}
        </p>
      )}
      <div role="group" aria-label={t('picker.day')} className="flex flex-wrap gap-2">
        <Chip pressed={isToday} onClick={() => pickDay(now)}>
          {t('picker.today')}
        </Chip>
        <Chip pressed={isOther} onClick={() => pickDay(other)}>
          {t(mode === 'past' ? 'picker.yesterday' : 'picker.tomorrow')}
        </Chip>
        <Chip pressed={!isToday && !isOther} aria-expanded={calendar} onClick={() => setCalendar(!calendar)}>
          {!isToday && !isOther ? at.toLocaleDateString([], { day: 'numeric', month: 'short' }) : t('picker.otherDay')}
        </Chip>
        {mode === 'past' && (
          <Chip
            pressed={false}
            onClick={() => {
              const n = nowMinute()
              setDay(startOfDay(n))
              setTime({ h: n.getHours(), m: n.getMinutes() })
            }}
          >
            {t('picker.now')}
          </Chip>
        )}
      </div>
      {calendar && <MonthCalendar value={at} onPick={pickDay} max={mode === 'past' ? now : undefined} />}
      <TimeWheels hour={at.getHours()} minute={at.getMinutes()} onChange={(h, m) => setTime({ h, m })} />
      <SheetActions onDone={() => onDone(at)} onClear={onClear} />
    </Sheet>
  )
}

function SheetActions({ onDone, onClear }: { onDone: () => void; onClear?: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex gap-2">
      {onClear && (
        <Button type="button" variant="ghost" size="lg" onClick={onClear}>
          {t('picker.clear')}
        </Button>
      )}
      <Button type="button" size="lg" className="flex-1" onClick={onDone}>
        {t('picker.done')}
      </Button>
    </div>
  )
}

/** A day on its own: Today and Yesterday (or Tomorrow for something planned), and the month calendar. */
export function DateSheet({
  label,
  initial,
  mode = 'past',
  onDone,
  onClear,
  onClose,
}: {
  label: string
  initial: Date
  mode?: PickMode
  onDone: (day: Date) => void
  onClear?: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [day, setDay] = useState(() => startOfDay(initial))
  const now = new Date()
  const today = startOfDay(now)
  const other = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (mode === 'past' ? -1 : 1))
  return (
    <Sheet title={label} onClose={onClose}>
      <p className="text-[1.75rem] leading-tight font-bold">{day.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</p>
      <div role="group" aria-label={t('picker.day')} className="flex flex-wrap gap-2">
        <Chip pressed={sameDay(day, today)} onClick={() => setDay(today)}>
          {t('picker.today')}
        </Chip>
        <Chip pressed={sameDay(day, other)} onClick={() => setDay(other)}>
          {t(mode === 'past' ? 'picker.yesterday' : 'picker.tomorrow')}
        </Chip>
      </div>
      <MonthCalendar value={day} onPick={setDay} max={mode === 'past' ? now : undefined} />
      <SheetActions onDone={() => onDone(day)} onClear={onClear} />
    </Sheet>
  )
}

/** A time of day on its own: the wheels. */
function TimeSheet({ label, initial, onDone, onClear, onClose }: { label: string; initial: { h: number; m: number }; onDone: (h: number, m: number) => void; onClear?: () => void; onClose: () => void }) {
  const [time, setTime] = useState(initial)
  return (
    <Sheet title={label} onClose={onClose}>
      <p className="text-[1.75rem] leading-tight font-bold tabular-nums">{formatTime(new Date(2000, 0, 1, time.h, time.m))}</p>
      <TimeWheels hour={time.h} minute={time.m} onChange={(h, m) => setTime({ h, m })} />
      <SheetActions onDone={() => onDone(time.h, time.m)} onClear={onClear} />
    </Sheet>
  )
}

type FieldProps = {
  /** names the button for a <label htmlFor={id}> */
  id?: string
  /** the sheet's title; also the button's name when there is no visible label (`labelled` false) */
  label: string
  labelled?: boolean
  clearable?: boolean
  disabled?: boolean
  /** smaller, without "Change", for table cells */
  compact?: boolean
  /** what an empty field says */
  placeholder?: string
  className?: string
}

/** The button a field shows: its value in words, or what to pick. */
function Trigger({ id, label, labelled = true, disabled, compact, className, text, empty, onOpen }: FieldProps & { text: string | null; empty: string; onOpen: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      id={id}
      type="button"
      aria-label={labelled ? undefined : label}
      disabled={disabled}
      onClick={onOpen}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-surface text-left focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none disabled:opacity-60',
        compact ? 'min-h-10 px-2 text-sm' : 'min-h-11 px-3 py-2 text-base',
        className,
      )}
    >
      <span className={cn('whitespace-nowrap', text ? 'font-bold tabular-nums' : 'text-muted')}>{text ?? empty}</span>
      {!compact && !disabled && <span className="text-sm font-bold text-primary">{t('picker.change')}</span>}
    </button>
  )
}

/** Opens `sheet` over everything, outside any form it sits in, so the picker's own buttons never submit that form. */
function usePortalSheet() {
  const [open, setOpen] = useState(false)
  return { open, show: () => setOpen(true), hide: () => setOpen(false), portal: (sheet: ReactNode) => (open ? createPortal(sheet, document.body) : null) }
}

/**
 * A date and time, shown in words ("Yesterday, 11:30 PM") and changed in a sheet: Today / Yesterday / another day, and
 * hour, minute and AM/PM wheels. The value is the "YYYY-MM-DDTHH:mm" a datetime-local input would hold ('' for none).
 * `past` (the default) keeps it out of the future; `planned` offers Tomorrow instead.
 */
export function DateTimeField({ value, onChange, mode = 'past', ...field }: FieldProps & { value: string; onChange: (value: string) => void; mode?: PickMode }) {
  const { t } = useTranslation()
  const sheet = usePortalSheet()
  const at = fromInput(value)
  const clear = field.clearable
    ? () => {
        onChange('')
        sheet.hide()
      }
    : undefined
  return (
    <>
      <Trigger {...field} text={at ? `${dayWord(at, t)}, ${formatTime(at)}` : null} empty={field.placeholder ?? t('picker.pick')} onOpen={sheet.show} />
      {sheet.portal(
        <DateTimeSheet
          label={field.label}
          initial={at ?? nowMinute()}
          mode={mode}
          onClose={sheet.hide}
          onDone={(d) => {
            onChange(toInput(d))
            sheet.hide()
          }}
          onClear={clear}
        />,
      )}
    </>
  )
}

/** A day on its own ("Tue, 10 Nov"); the value is "YYYY-MM-DD" ('' for none). */
export function DateField({ value, onChange, mode = 'past', ...field }: FieldProps & { value: string; onChange: (value: string) => void; mode?: PickMode }) {
  const { t } = useTranslation()
  const sheet = usePortalSheet()
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? fromInput(`${value}T00:00`) : null
  return (
    <>
      <Trigger {...field} text={day ? dayWord(day, t) : null} empty={field.placeholder ?? t('picker.pickDay')} onOpen={sheet.show} />
      {sheet.portal(
        <DateSheet
          label={field.label}
          initial={day ?? new Date()}
          mode={mode}
          onClose={sheet.hide}
          onDone={(d) => {
            onChange(toLocalDate(d))
            sheet.hide()
          }}
          onClear={
            field.clearable
              ? () => {
                  onChange('')
                  sheet.hide()
                }
              : undefined
          }
        />,
      )}
    </>
  )
}

/** A time of day on its own ("8:00 AM"); the value is "HH:mm" ('' for none). */
export function TimeField({ value, onChange, ...field }: FieldProps & { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation()
  const sheet = usePortalSheet()
  const m = /^(\d{2}):(\d{2})/.exec(value)
  const time = m ? { h: Number(m[1]), m: Number(m[2]) } : null
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    <>
      <Trigger {...field} text={time ? formatTime(new Date(2000, 0, 1, time.h, time.m)) : null} empty={field.placeholder ?? t('picker.pick')} onOpen={sheet.show} />
      {sheet.portal(
        <TimeSheet
          label={field.label}
          initial={time ?? { h: nowMinute().getHours(), m: nowMinute().getMinutes() }}
          onClose={sheet.hide}
          onDone={(h, mm) => {
            onChange(`${pad(h)}:${pad(mm)}`)
            sheet.hide()
          }}
          onClear={
            field.clearable
              ? () => {
                  onChange('')
                  sheet.hide()
                }
              : undefined
          }
        />,
      )}
    </>
  )
}
