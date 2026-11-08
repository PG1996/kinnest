import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlaceKind, Vital, VitalInput } from '../api/hooks'
import { cn } from '../lib/cn'
import { toLocalInput } from '../lib/time'
import { MEASUREMENTS, validateVital, type MeasurementKey } from '../lib/vitals'
import { PLACES } from '../lib/vitalsFormat'
import { Button } from './ui/button'
import { Input } from './ui/field'

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
    Object.fromEntries(MEASUREMENTS.map((m) => [m.key, initial?.[m.key] != null ? String(initial[m.key]) : ''])),
  )
  const [when, setWhen] = useState(() => toLocalInput(initial ? new Date(initial.measured_at) : new Date()))
  const [place, setPlace] = useState<PlaceKind>(initial?.place_kind ?? 'home')
  const [placeName, setPlaceName] = useState(initial?.place_name ?? '')
  const [measuredBy, setMeasuredBy] = useState(initial?.measured_by ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

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
    }
    for (const m of MEASUREMENTS) {
      const raw = values[m.key].trim().replace(',', '.')
      input[m.key] = chosen.has(m.key) ? (raw === '' ? Number.NaN : Number(raw)) : null
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
          {MEASUREMENTS.map((m) => (
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
        </div>
      </fieldset>
      {MEASUREMENTS.filter((m) => chosen.has(m.key)).map((m) => (
        <div key={m.key}>
          <label htmlFor={`vital-${m.key}`} className="block text-sm">
            {`${t(m.label)} (${t(m.unit)})`}
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
          <p className="text-xs text-muted">{t('vitals.form.range', { min: m.min, max: m.max, unit: t(m.unit) })}</p>
          {errors[m.key] && <p className="text-sm text-danger">{errors[m.key]}</p>}
        </div>
      ))}
      {errors._form && <p className="text-sm text-danger">{errors._form}</p>}
      <div>
        <label htmlFor="vital-when" className="block text-sm text-muted">
          {t('vitals.form.when')}
        </label>
        <Input id="vital-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
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
