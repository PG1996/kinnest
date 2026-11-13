import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useKid, type PlaceKind, type Vital } from '../api/hooks'
import { dayOfIso, groupByDay, monthOf, monthRange } from '../lib/calendar'
import { cn } from '../lib/cn'
import { PLACE_COLORS } from '../lib/placeColors'
import { toLocalDate } from '../lib/time'
import { useTempUnit } from '../lib/tempUnit'
import { MEASUREMENTS, type MeasurementKey } from '../lib/vitals'
import { PLACES } from '../lib/vitalsFormat'
import HistoryCalendar, { PickedDay } from './HistoryCalendar'
import VitalList, { type VitalRow } from './VitalList'
import { Button } from './ui/button'

/** A reading with a temperature this high marks its day amber. */
const FEVER_C = 38
const fever = (v: VitalRow) => (v.temperature_c ?? 0) >= FEVER_C
const newestFirst = (a: VitalRow, b: VitalRow) => Date.parse(b.measured_at) - Date.parse(a.measured_at)

/**
 * The Vitals tab's Calendar view: a dot per reading on the day it was taken, coloured by place, with fever days in
 * amber. The list under it follows the month shown, or the day picked.
 */
export default function VitalsCalendar({
  rows,
  canEdit,
  onEdit,
  onDelete,
  onAddDay,
}: {
  rows: VitalRow[]
  canEdit: boolean
  onEdit: (v: Vital) => void
  onDelete: (id: string) => void
  onAddDay: (day: string) => void
}) {
  const { t } = useTranslation()
  useTempUnit() // re-render when °F / °C changes
  const birth = useKid().data?.birth_date
  const [today] = useState(() => toLocalDate(new Date()))
  const [month, setMonth] = useState(() => monthOf(today))
  const [day, setDay] = useState<string | null>(null)
  const [metric, setMetric] = useState<MeasurementKey | 'all'>('all')
  const [hidden, setHidden] = useState<Set<PlaceKind>>(new Set())
  const dayOf = (v: VitalRow) => dayOfIso(v.measured_at)
  const shown = rows.filter((v) => !hidden.has(v.place_kind) && (metric === 'all' || v[metric] != null))
  const days = groupByDay(shown, dayOf)
  // the months on offer come from every reading, so a filter does not move them
  const range = monthRange(groupByDay(rows, dayOf).keys(), today, birth)
  const flip = (p: PlaceKind) => {
    const next = new Set(hidden)
    if (next.has(p)) next.delete(p)
    else next.add(p)
    setHidden(next)
  }
  const list = (day ? (days.get(day) ?? []) : shown.filter((v) => monthOf(dayOf(v)) === month)).slice().sort(newestFirst)
  const monthName = new Date(`${month}-01T00:00:00`).toLocaleDateString([], { month: 'long' })

  return (
    <div className="space-y-3">
      <HistoryCalendar
        label={t('vitals.calendar.label')}
        days={days}
        month={month}
        onMonth={setMonth}
        selected={day}
        onSelect={setDay}
        range={range}
        firstDay={birth}
        warn={(l) => l.some(fever)}
        marks={(l) => (
          <>
            {l.slice(0, 3).map((v) => (
              <i key={v.id} className="inline-block size-[7px] rounded-full" style={{ background: PLACE_COLORS[v.place_kind] }} />
            ))}
            {l.length > 3 && <span>+{l.length - 3}</span>}
          </>
        )}
        describe={(l) => [t('vitals.calendar.readings', { count: l.length }), l.some(fever) && t('vitals.calendar.fever')].filter(Boolean).join(', ')}
        mini={(l) => PLACE_COLORS[l[0].place_kind]}
        summary={(count) => t('vitals.calendar.days', { count })}
      >
        <div role="group" aria-label={t('vitals.calendar.showDays')} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
          {(['all', ...MEASUREMENTS.map((m) => m.key)] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={metric === k}
              onClick={() => setMetric(k)}
              className={cn(
                'min-h-9 flex-none rounded-full border px-3 text-[13px] font-semibold',
                metric === k ? 'border-primary bg-primary text-primary-ink' : 'border-line bg-surface text-ink',
              )}
            >
              {k === 'all' ? t('vitals.calendar.all') : t(MEASUREMENTS.find((m) => m.key === k)!.label)}
            </button>
          ))}
        </div>
        <div role="group" aria-label={t('vitals.calendar.places')} className="flex flex-wrap items-center gap-1.5">
          {PLACES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={!hidden.has(p)}
              onClick={() => flip(p)}
              className={cn(
                'flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold',
                hidden.has(p) ? 'border-dashed border-line text-muted' : 'border-line',
              )}
            >
              <span aria-hidden="true" className={cn('size-2.5 rounded-full', hidden.has(p) && 'opacity-30')} style={{ background: PLACE_COLORS[p] }} />
              {t(`vitals.places.${p}`)}
            </button>
          ))}
          <span className="flex items-center gap-1.5 text-xs font-semibold text-muted">
            <span aria-hidden="true" className="size-3.5 rounded-[4px] border-[1.5px] border-warn-solid bg-warn-bg" />
            {t('vitals.calendar.feverKey')}
          </span>
        </div>
      </HistoryCalendar>
      {day ? (
        <PickedDay day={day} count={list.length ? t('vitals.calendar.readings', { count: list.length }) : ''} onClear={() => setDay(null)} />
      ) : (
        <div className="flex min-h-9 items-center justify-between gap-2 px-1">
          <h3 className="font-bold">{t('vitals.calendar.monthTitle', { month: monthName })}</h3>
          <span className="text-sm font-semibold text-muted tabular-nums">{list.length}</span>
        </div>
      )}
      {list.length > 0 ? (
        <VitalList rows={list} canEdit={canEdit} onEdit={onEdit} onDelete={onDelete} />
      ) : (
        <div className="space-y-3 rounded-card bg-surface p-4 text-sm text-muted">
          <p>{day ? t('calendar.emptyDay') : t('vitals.calendar.monthEmpty', { month: monthName })}</p>
          {day && canEdit && day <= today && (
            <Button variant="soft" onClick={() => onAddDay(day)}>
              {t('vitals.calendar.addDay')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
