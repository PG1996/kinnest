import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Medicine, ScheduleKind } from '../api/hooks'
import { cn } from '../lib/cn'
import { toLocalInput } from '../lib/time'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Input } from './ui/field'

const KINDS: ScheduleKind[] = ['fixed', 'interval', 'as_needed']
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

type Values = {
  name: string
  dose: string
  kind: ScheduleKind
  times: string[]
  intervalHours: string
  firstDose: string
  minGap: string
  startDate: string
  endDate: string
  notes: string
}

function initial(m?: Medicine): Values {
  return {
    name: m?.name ?? '',
    dose: m?.dose ?? '',
    kind: m?.schedule_kind ?? 'fixed',
    times: m?.times.length ? [...m.times] : ['09:00'],
    intervalHours: m?.interval_hours != null ? String(m.interval_hours) : '8',
    firstDose: m?.first_dose_at ? toLocalInput(new Date(m.first_dose_at)) : toLocalInput(new Date()),
    minGap: m?.min_gap_hours != null ? String(m.min_gap_hours) : '',
    startDate: m?.start_date ?? toLocalInput(new Date()).slice(0, 10),
    endDate: m?.end_date ?? '',
    notes: m?.notes ?? '',
  }
}

const wholeNumber = (s: string, min: number, max: number) => /^\d+$/.test(s) && Number(s) >= min && Number(s) <= max

/** The request body for the API, or null when the form is not valid (the server checks again). */
function toBody(v: Values): Record<string, unknown> | null {
  if (!v.name.trim() || !v.startDate || (v.endDate && v.endDate < v.startDate)) return null
  const common = { name: v.name.trim(), dose: v.dose.trim(), schedule_kind: v.kind, start_date: v.startDate, end_date: v.endDate || null, notes: v.notes }
  if (v.kind === 'fixed') {
    if (!v.times.length || v.times.some((x) => !TIME.test(x)) || new Set(v.times).size !== v.times.length) return null
    return { ...common, times: v.times }
  }
  if (v.kind === 'interval') {
    if (!wholeNumber(v.intervalHours, 1, 72) || !v.firstDose) return null
    return { ...common, interval_hours: Number(v.intervalHours), first_dose_at: new Date(v.firstDose).toISOString() }
  }
  if (v.minGap && !wholeNumber(v.minGap, 1, 48)) return null
  return { ...common, min_gap_hours: v.minGap ? Number(v.minGap) : null }
}

type Props = { medicine?: Medicine; saving: boolean; failed: boolean; onSave: (body: Record<string, unknown>) => void; onCancel: () => void }

export default function MedicineForm({ medicine, saving, failed, onSave, onCancel }: Props) {
  const { t } = useTranslation()
  const [v, setV] = useState(() => initial(medicine))
  const [invalid, setInvalid] = useState(false)
  const set = <K extends keyof Values>(k: K, value: Values[K]) => setV((prev) => ({ ...prev, [k]: value }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const body = toBody(v)
    setInvalid(body === null)
    if (body) onSave(body)
  }
  const label = (id: string, text: string) => (
    <label htmlFor={id} className="block text-sm text-muted">
      {text}
    </label>
  )

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3">
        {label('med-name', t('medicines.form.name'))}
        <Input id="med-name" value={v.name} onChange={(e) => set('name', e.target.value)} />
        {label('med-dose', t('medicines.form.dose'))}
        <Input id="med-dose" value={v.dose} onChange={(e) => set('dose', e.target.value)} />

        <fieldset className="flex flex-wrap gap-2" aria-label={t('medicines.form.kindLabel')}>
          {KINDS.map((k) => (
            <label
              key={k}
              className={cn(
                'flex min-h-12 cursor-pointer items-center rounded-full border border-line px-4',
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
                <Input
                  type="time"
                  aria-label={t('medicines.form.timeN', { n: i + 1 })}
                  value={time}
                  onChange={(e) => set('times', v.times.map((x, j) => (j === i ? e.target.value : x)))}
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
            <Input id="med-first" type="datetime-local" value={v.firstDose} onChange={(e) => set('firstDose', e.target.value)} />
          </>
        )}
        {v.kind === 'as_needed' && (
          <>
            {label('med-gap', t('medicines.form.minGap'))}
            <Input id="med-gap" type="number" inputMode="numeric" min={1} max={48} value={v.minGap} onChange={(e) => set('minGap', e.target.value)} />
          </>
        )}

        {label('med-start', t('medicines.form.startDate'))}
        <Input id="med-start" type="date" value={v.startDate} onChange={(e) => set('startDate', e.target.value)} />
        {label('med-end', t('medicines.form.endDate'))}
        <Input id="med-end" type="date" value={v.endDate} onChange={(e) => set('endDate', e.target.value)} />
        {label('med-notes', t('medicines.form.notes'))}
        <Input id="med-notes" value={v.notes} onChange={(e) => set('notes', e.target.value)} />

        {invalid && <p className="text-sm text-danger">{t('medicines.form.invalid')}</p>}
        {failed && <p className="text-sm text-danger">{t('common.error')}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Button type="submit" disabled={saving}>
            {t('medicines.form.save')}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('medicines.form.cancel')}
          </Button>
        </div>
      </form>
    </Card>
  )
}
