import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Medicine, ScheduleKind } from '../api/hooks'
import { cn } from '../lib/cn'
import { toLocalInput } from '../lib/time'
import { DOSE_UNITS } from '../lib/units'
import { Button } from './ui/button'
import { Input, Select } from './ui/field'
import { DateField, DateTimeField, TimeField } from './ui/datetime'

const KINDS: ScheduleKind[] = ['fixed', 'interval', 'as_needed']
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

type Values = {
  name: string
  doseAmount: string
  doseUnit: string
  kind: ScheduleKind
  times: string[]
  intervalHours: string
  firstDose: string
  minGap: string
  maxPerDay: string
  usualStart: string
  startDate: string
  endDate: string
  notes: string
}

function initial(m?: Medicine, kind?: ScheduleKind): Values {
  return {
    name: m?.name ?? '',
    doseAmount: m?.dose_amount != null ? String(m.dose_amount) : '',
    doseUnit: m?.dose_unit ?? '',
    kind: m?.schedule_kind ?? kind ?? 'fixed',
    times: m?.times.length ? [...m.times] : ['09:00'],
    intervalHours: m?.interval_hours != null ? String(m.interval_hours) : '8',
    firstDose: m?.first_dose_at ? toLocalInput(new Date(m.first_dose_at)) : toLocalInput(new Date()),
    minGap: m?.min_gap_hours != null ? String(m.min_gap_hours) : '',
    maxPerDay: m?.max_per_day != null ? String(m.max_per_day) : '',
    usualStart: m?.day_start ?? '',
    startDate: m?.start_date ?? toLocalInput(new Date()).slice(0, 10),
    endDate: m?.end_date ?? '',
    notes: m?.notes ?? '',
  }
}

const wholeNumber = (s: string, min: number, max: number) => /^\d+$/.test(s) && Number(s) >= min && Number(s) <= max
/** A positive amount with at most 2 decimals, up to 10000. */
const validAmount = (s: string) => /^\d+(\.\d{1,2})?$/.test(s) && Number(s) > 0 && Number(s) <= 10000

/** The request body for the API, or null when the form is not valid (the server checks again). */
function toBody(v: Values): Record<string, unknown> | null {
  if (!v.name.trim() || !v.startDate || (v.endDate && v.endDate < v.startDate)) return null
  if (!validAmount(v.doseAmount) || !(DOSE_UNITS as readonly string[]).includes(v.doseUnit)) return null
  const common = { name: v.name.trim(), dose_amount: Number(v.doseAmount), dose_unit: v.doseUnit, schedule_kind: v.kind, start_date: v.startDate, end_date: v.endDate || null, notes: v.notes }
  if (v.kind === 'fixed') {
    if (!v.times.length || v.times.some((x) => !TIME.test(x)) || new Set(v.times).size !== v.times.length) return null
    return { ...common, times: v.times }
  }
  if (v.kind === 'interval') {
    if (!wholeNumber(v.intervalHours, 1, 72) || !v.firstDose) return null
    if (v.maxPerDay && !wholeNumber(v.maxPerDay, 1, 24)) return null
    if (v.usualStart && !TIME.test(v.usualStart)) return null
    return {
      ...common,
      interval_hours: Number(v.intervalHours),
      first_dose_at: new Date(v.firstDose).toISOString(),
      max_per_day: v.maxPerDay ? Number(v.maxPerDay) : null,
      // the usual first dose time only matters with a maximum; unset, the server uses the time of the first dose
      day_start: v.maxPerDay ? v.usualStart || v.firstDose.slice(11, 16) : null,
    }
  }
  if (v.minGap && !wholeNumber(v.minGap, 1, 48)) return null
  if (v.maxPerDay && !wholeNumber(v.maxPerDay, 1, 24)) return null
  return { ...common, min_gap_hours: v.minGap ? Number(v.minGap) : null, max_per_day: v.maxPerDay ? Number(v.maxPerDay) : null }
}

type Props = { medicine?: Medicine; /** the schedule kind a new medicine starts on (SOS opens on `as_needed`) */ initialKind?: ScheduleKind; saving: boolean; failed: boolean; onSave: (body: Record<string, unknown>) => void; onCancel: () => void }

export default function MedicineForm({ medicine, initialKind, saving, failed, onSave, onCancel }: Props) {
  const { t } = useTranslation()
  const [v, setV] = useState(() => initial(medicine, initialKind))
  const [invalid, setInvalid] = useState(false)
  const set = <K extends keyof Values>(k: K, value: Values[K]) => setV((prev) => ({ ...prev, [k]: value }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const body = toBody(v)
    setInvalid(body === null)
    if (body) onSave(body)
  }
  const label = (id: string, text: string) => (
    <label htmlFor={id} className="block text-xs font-medium text-muted">
      {text}
    </label>
  )

  return (
    <form onSubmit={submit} noValidate className="space-y-2.5">
        {label('med-name', t('medicines.form.name'))}
        <Input id="med-name" value={v.name} onChange={(e) => set('name', e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            {label('med-amount', t('medicines.form.doseAmount'))}
            <Input
              id="med-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={v.doseAmount}
              onChange={(e) => set('doseAmount', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            {label('med-unit', t('medicines.form.doseUnit'))}
            <Select id="med-unit" value={v.doseUnit} onChange={(e) => set('doseUnit', e.target.value)}>
              <option value="">{t('medicines.form.chooseUnit')}</option>
              {DOSE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {t(`units.${u}`, { count: 2 })}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <fieldset className="flex flex-wrap gap-2" aria-label={t('medicines.form.kindLabel')}>
          {KINDS.map((k) => (
            <label
              key={k}
              className={cn(
                'flex min-h-10 cursor-pointer items-center rounded-full border border-line px-3.5 text-sm',
                v.kind === k && 'border-primary bg-primary text-primary-ink',
              )}
            >
              <input type="radio" name="med-kind" className="sr-only" checked={v.kind === k} onChange={() => set('kind', k)} />
              {t(`medicines.form.kind.${k}`)}
            </label>
          ))}
        </fieldset>

        {v.kind === 'fixed' && (
          <div className="space-y-2">
            {v.times.map((time, i) => (
              <div key={i} className="flex items-center gap-2">
                <TimeField
                  label={t('medicines.form.timeN', { n: i + 1 })}
                  labelled={false}
                  value={time}
                  onChange={(x) => set('times', v.times.map((y, j) => (j === i ? x : y)))}
                />
                {v.times.length > 1 && (
                  <Button type="button" variant="ghost" aria-label={t('medicines.form.removeTime', { n: i + 1 })} onClick={() => set('times', v.times.filter((_, j) => j !== i))}>
                    ✕
                  </Button>
                )}
              </div>
            ))}
            <Button type="button" variant="soft" onClick={() => set('times', [...v.times, ''])}>
              {t('medicines.form.addTime')}
            </Button>
          </div>
        )}
        {v.kind === 'interval' && (
          <>
            {label('med-hours', t('medicines.form.intervalHours'))}
            <Input id="med-hours" type="number" inputMode="numeric" min={1} max={72} value={v.intervalHours} onChange={(e) => set('intervalHours', e.target.value)} />
            {label('med-first', t('medicines.form.firstDose'))}
            <DateTimeField id="med-first" label={t('medicines.form.firstDose')} mode="planned" value={v.firstDose} onChange={(x) => set('firstDose', x)} />
            {label('med-max', t('medicines.form.maxPerDay'))}
            <Input id="med-max" type="number" inputMode="numeric" min={1} max={24} value={v.maxPerDay} onChange={(e) => set('maxPerDay', e.target.value)} />
            {v.maxPerDay && (
              <>
                {label('med-usual', t('medicines.form.usualStart'))}
                <TimeField id="med-usual" label={t('medicines.form.usualStart')} value={v.usualStart || v.firstDose.slice(11, 16)} onChange={(x) => set('usualStart', x)} />
                <p className="text-xs text-muted">{t('medicines.form.usualStartHint')}</p>
              </>
            )}
          </>
        )}
        {v.kind === 'as_needed' && (
          <>
            {label('med-gap', t('medicines.form.minGap'))}
            <Input id="med-gap" type="number" inputMode="numeric" min={1} max={48} value={v.minGap} onChange={(e) => set('minGap', e.target.value)} />
            {label('med-max-sos', t('medicines.form.maxPerDaySos'))}
            <Input id="med-max-sos" type="number" inputMode="numeric" min={1} max={24} value={v.maxPerDay} onChange={(e) => set('maxPerDay', e.target.value)} />
          </>
        )}

        {label('med-start', t('medicines.form.startDate'))}
        <DateField id="med-start" label={t('medicines.form.startDate')} mode="planned" value={v.startDate} onChange={(x) => set('startDate', x)} />
        {label('med-end', t('medicines.form.endDate'))}
        <DateField id="med-end" label={t('medicines.form.endDate')} mode="planned" clearable placeholder={t('picker.noEnd')} value={v.endDate} onChange={(x) => set('endDate', x)} />
        {label('med-notes', t('medicines.form.notes'))}
        <Input id="med-notes" value={v.notes} onChange={(e) => set('notes', e.target.value)} />

        {invalid && <p className="text-sm text-danger">{t('medicines.form.invalid')}</p>}
        {failed && <p className="text-sm text-danger">{t('common.error')}</p>}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <Button type="submit" disabled={saving}>
            {t('medicines.form.save')}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('medicines.form.cancel')}
          </Button>
        </div>
    </form>
  )
}
