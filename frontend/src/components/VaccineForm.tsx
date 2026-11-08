import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Vaccination } from '../api/hooks'
import type { VaccineInput } from '../hooks/log'
import { toLocalDate } from '../lib/time'
import { Button } from './ui/button'
import { Input } from './ui/field'

export type VaccineFormMode = 'add' | 'edit' | 'given'

/** Add or edit a vaccine, or mark one given (date defaults to today, place and notes). */
export default function VaccineForm({
  mode,
  initial,
  saving,
  serverError,
  onSave,
}: {
  mode: VaccineFormMode
  initial?: Vaccination
  saving?: boolean
  serverError?: string
  onSave: (body: VaccineInput) => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial?.name ?? '')
  const [dose, setDose] = useState(initial?.dose_label ?? '')
  const [due, setDue] = useState(initial?.due_date ?? '')
  const [givenOn, setGivenOn] = useState(initial?.given_on ?? toLocalDate(new Date()))
  const [place, setPlace] = useState(initial?.place ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [error, setError] = useState('')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (mode === 'given') {
      if (!givenOn || givenOn > toLocalDate(new Date())) return setError(t('vaccines.form.futureGiven'))
      return onSave({ status: 'given', given_on: givenOn, place: place.trim(), notes: notes.trim() })
    }
    if (!name.trim() || !due) return setError(t('vaccines.form.required'))
    onSave({ name: name.trim(), dose_label: dose.trim(), due_date: due, notes: notes.trim() })
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
      {mode === 'given' ? (
        <>
          {initial && <p className="font-medium">{`${initial.name} ${initial.dose_label}`.trim()}</p>}
          {field('vax-given', t('vaccines.form.givenOn'), givenOn, setGivenOn, 'date')}
          {field('vax-place', t('vaccines.form.place'), place, setPlace)}
        </>
      ) : (
        <>
          {field('vax-name', t('vaccines.form.name'), name, setName)}
          {field('vax-dose', t('vaccines.form.dose'), dose, setDose)}
          {field('vax-due', t('vaccines.form.dueDate'), due, setDue, 'date')}
        </>
      )}
      {field('vax-notes', t('vaccines.form.notes'), notes, setNotes)}
      {(error || serverError) && <p className="text-sm text-danger">{error || serverError}</p>}
      <Button type="submit" className="w-full" disabled={saving}>
        {t('vaccines.form.save')}
      </Button>
    </form>
  )
}
