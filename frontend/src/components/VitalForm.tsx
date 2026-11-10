import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useVisits, type PlaceKind, type Vital, type VitalInput } from '../api/hooks'
import { cn } from '../lib/cn'
import { formatTime, toLocalInput } from '../lib/time'
import { MAIN_KEYS, MEASUREMENTS, MORE_KEYS, shownRange, shownUnit, shownValue, storedValue, validateVital, type MeasurementKey } from '../lib/vitals'
import { PLACES } from '../lib/vitalsFormat'
import { Button } from './ui/button'
import { Input, Select } from './ui/field'
import { DateTimeField } from './ui/datetime'

const chipClass = (on: boolean) =>
  cn('min-h-10 rounded-full border px-3 text-sm', on ? 'border-primary bg-primary text-primary-ink' : 'border-line')

/** One form for adding and editing a vitals entry: pick the measurements, then fill them in. */
export default function VitalForm({
  initial,
  saving,
  serverError,
  onSave,
}: {
  initial?: Vital
  saving?: boolean
  serverError?: string
  onSave: (input: VitalInput) => void
}) {
  const { t } = useTranslation()
  const [chosen, setChosen] = useState<Set<MeasurementKey>>(
    () => new Set(MEASUREMENTS.filter((m) => initial?.[m.key] != null).map((m) => m.key)),
  )
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(MEASUREMENTS.map((m) => [m.key, initial?.[m.key] != null ? String(shownValue(m.key, initial[m.key] as number)) : ''])),
  )
  const [when, setWhen] = useState(() => toLocalInput(initial ? new Date(initial.measured_at) : new Date()))
  const [place, setPlace] = useState<PlaceKind>(initial?.place_kind ?? 'home')
  const [placeName, setPlaceName] = useState(initial?.place_name ?? '')
  const [measuredBy, setMeasuredBy] = useState(initial?.measured_by ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  // the visit this reading belongs to: '' none, 'new' make one, or a visit id; untouched, a visit that day is suggested
  const [visitPick, setVisitPick] = useState<string | null>(initial ? (initial.visit_id ?? '') : null)
  const visits = useVisits().data
  const atVisit = place !== 'home'
  const sameDay = (iso: string) => new Date(iso).toDateString() === new Date(when).toDateString()
  const dayVisits = (Array.isArray(visits) ? visits : []).filter((v) => v.status !== 'cancelled' && (sameDay(v.scheduled_at) || v.id === initial?.visit_id))
  const suggested = dayVisits.find((v) => placeName && v.place.toLowerCase() === placeName.trim().toLowerCase()) ?? dayVisits[0]
  const visitValue = visitPick ?? suggested?.id ?? ''
  const [errors, setErrors] = useState<Record<string, string>>({})
  // heart rate, breathing rate and SpO2 are clinic readings: hidden unless asked for or already filled in
  const [more, setMore] = useState(() => MORE_KEYS.some((k) => initial?.[k] != null))
  const offered = MEASUREMENTS.filter((m) => MAIN_KEYS.includes(m.key) || more)

  const toggle = (k: MeasurementKey) => {
    const next = new Set(chosen)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setChosen(next)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const input: VitalInput = {
      id: initial?.id ?? crypto.randomUUID(),
      measured_at: new Date(when).toISOString(),
      place_kind: place,
      place_name: placeName.trim(),
      measured_by: measuredBy.trim(),
      note: note.trim(),
      visit_id: atVisit && visitValue && visitValue !== 'new' ? visitValue : null,
      create_visit: atVisit && visitValue === 'new',
    }
    for (const m of MEASUREMENTS) {
      const raw = values[m.key].trim().replace(',', '.')
      input[m.key] = chosen.has(m.key) ? (raw === '' ? Number.NaN : storedValue(m.key, Number(raw))) : null
    }
    const problems = validateVital(input)
    setErrors(problems)
    if (Object.keys(problems).length === 0) onSave(input)
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <fieldset className="space-y-2">
        <legend className="text-sm text-muted">{t('vitals.form.which')}</legend>
        <div className="flex flex-wrap gap-2">
          {offered.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={chosen.has(m.key)}
              className={chipClass(chosen.has(m.key))}
              onClick={() => toggle(m.key)}
            >
              {t(m.label)}
            </button>
          ))}
          {!more && (
            <button type="button" aria-expanded={false} className={chipClass(false) + ' border-dashed text-muted'} onClick={() => setMore(true)}>
              {t('vitals.form.more')}
            </button>
          )}
        </div>
      </fieldset>
      {MEASUREMENTS.filter((m) => chosen.has(m.key)).map((m) => (
        <div key={m.key}>
          <label htmlFor={`vital-${m.key}`} className="block text-sm">
            {`${t(m.label)} (${t(shownUnit(m))})`}
          </label>
          <Input
            id={`vital-${m.key}`}
            type="number"
            step="any"
            inputMode="decimal"
            value={values[m.key]}
            onChange={(e) => setValues({ ...values, [m.key]: e.target.value })}
            aria-invalid={!!errors[m.key]}
          />
          <p className="text-xs text-muted">{t('vitals.form.range', { ...shownRange(m), unit: t(shownUnit(m)) })}</p>
          {errors[m.key] && <p className="text-sm text-danger">{errors[m.key]}</p>}
        </div>
      ))}
      {errors._form && <p className="text-sm text-danger">{errors._form}</p>}
      <div>
        <label htmlFor="vital-when" className="block text-sm text-muted">
          {t('vitals.form.when')}
        </label>
        <DateTimeField id="vital-when" label={t('vitals.form.when')} value={when} onChange={setWhen} />
        {errors.measured_at && <p className="text-sm text-danger">{errors.measured_at}</p>}
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm text-muted">{t('vitals.form.place')}</legend>
        <div className="flex flex-wrap gap-2">
          {PLACES.map((p) => (
            <button key={p} type="button" aria-pressed={place === p} className={chipClass(place === p)} onClick={() => setPlace(p)}>
              {t(`vitals.places.${p}`)}
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="vital-place-name" className="block text-sm text-muted">
          {t('vitals.form.placeName')}
        </label>
        <Input id="vital-place-name" value={placeName} maxLength={120} onChange={(e) => setPlaceName(e.target.value)} />
      </div>
      {atVisit && (
        <div>
          <label htmlFor="vital-visit" className="block text-sm text-muted">
            {t('vitals.form.visit')}
          </label>
          <Select id="vital-visit" value={visitValue} onChange={(e) => setVisitPick(e.target.value)}>
            <option value="">{t('vitals.form.noVisit')}</option>
            {dayVisits.map((v) => (
              <option key={v.id} value={v.id}>
                {t('vitals.form.visitOption', { time: formatTime(v.scheduled_at), who: [v.doctor, v.place].filter(Boolean).join(', ') || v.reason })}
              </option>
            ))}
            <option value="new">{t('vitals.form.newVisit')}</option>
          </Select>
        </div>
      )}
      <div>
        <label htmlFor="vital-measured-by" className="block text-sm text-muted">
          {t('vitals.form.measuredBy')}
        </label>
        <Input id="vital-measured-by" value={measuredBy} maxLength={120} onChange={(e) => setMeasuredBy(e.target.value)} />
      </div>
      <div>
        <label htmlFor="vital-note" className="block text-sm text-muted">
          {t('vitals.form.note')}
        </label>
        <Input id="vital-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {serverError && <p className="text-sm text-danger">{serverError}</p>}
      <Button type="submit" className="w-full" disabled={saving}>
        {t('vitals.form.save')}
      </Button>
    </form>
  )
}
