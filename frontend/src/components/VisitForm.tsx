import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Visit } from '../api/hooks'
import type { VisitInput } from '../hooks/log'
import { toLocalInput } from '../lib/time'
import { Button } from './ui/button'
import { Input } from './ui/field'

export type VisitFormMode = 'add' | 'edit' | 'done'

/** Plan a visit (date and time, doctor, place, reason), or record how it went (notes, prescription notes). */
export default function VisitForm({
  mode,
  initial,
  saving,
  serverError,
  onSave,
}: {
  mode: VisitFormMode
  initial?: Visit
  saving?: boolean
  serverError?: string
  onSave: (body: VisitInput) => void
}) {
  const { t } = useTranslation()
  const [when, setWhen] = useState(() => toLocalInput(initial ? new Date(initial.scheduled_at) : new Date()))
  const [doctor, setDoctor] = useState(initial?.doctor ?? '')
  const [place, setPlace] = useState(initial?.place ?? '')
  const [reason, setReason] = useState(initial?.reason ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [rx, setRx] = useState(initial?.prescription_notes ?? '')
  const [error, setError] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (mode === 'done') return onSave({ status: 'done', notes: notes.trim(), prescription_notes: rx.trim() })
    const at = new Date(when)
    if (!when || Number.isNaN(at.getTime())) return setError(t('visits.form.invalid'))
    const body: VisitInput = { scheduled_at: at.toISOString(), doctor: doctor.trim(), place: place.trim(), reason: reason.trim() }
    if (mode === 'edit') Object.assign(body, { notes: notes.trim(), prescription_notes: rx.trim() })
    onSave(body)
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void, type = 'text') => (
    <div>
      <label htmlFor={id} className="block text-sm text-muted">
        {label}
      </label>
      <Input id={id} type={type} value={value} onChange={(e) => set(e.target.value)} />
    </div>
  )

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {mode !== 'done' && (
        <>
          {field('visit-when', t('visits.form.when'), when, setWhen, 'datetime-local')}
          {field('visit-doctor', t('visits.form.doctor'), doctor, setDoctor)}
          {field('visit-place', t('visits.form.place'), place, setPlace)}
          {field('visit-reason', t('visits.form.reason'), reason, setReason)}
        </>
      )}
      {mode !== 'add' && (
        <>
          {field('visit-notes', t('visits.form.notes'), notes, setNotes)}
          {field('visit-rx', t('visits.form.prescription'), rx, setRx)}
        </>
      )}
      {(error || serverError) && <p className="text-sm text-danger">{error || serverError}</p>}
      <Button type="submit" className="w-full" disabled={saving}>
        {t('visits.form.save')}
      </Button>
    </form>
  )
}
