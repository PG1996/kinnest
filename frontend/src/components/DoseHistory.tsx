import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useDoseHistory, type DoseRow, type Medicine } from '../api/hooks'
import { useFixDose, useRecordPastDose, useUndoDose } from '../hooks/log'
import { toLocalInput } from '../lib/time'
import { formatDose } from '../lib/units'
import { formatWhen } from '../lib/vitalsFormat'
import Sheet from './Sheet'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Chip, ChipGroup } from './ui/chip'
import { Input } from './ui/field'

/** Add a past dose, or fix an existing one (admin). */
function DoseForm({ medicine, dose, onClose }: { medicine: Medicine; dose?: DoseRow; onClose: () => void }) {
  const { t } = useTranslation()
  const record = useRecordPastDose()
  const fix = useFixDose()
  const [when, setWhen] = useState(() => toLocalInput(dose ? new Date(dose.given_at) : new Date()))
  const [status, setStatus] = useState<'given' | 'skipped'>(dose?.status ?? 'given')
  const [amount, setAmount] = useState(dose?.amount != null ? String(dose.amount) : medicine.dose_amount != null && !dose ? String(medicine.dose_amount) : '')
  const [note, setNote] = useState(dose?.note ?? '')
  const [error, setError] = useState('')
  const saving = record.isPending || fix.isPending

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const at = new Date(when)
    if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 2 * 60_000) return setError(t('medicines.timeFuture'))
    const n = amount.trim() === '' ? undefined : Number(amount.replace(',', '.'))
    if (status === 'given' && n !== undefined && !(n > 0)) return setError(t('medicines.history.saveError'))
    setError('')
    const done = { onSuccess: onClose, onError: () => setError(t('medicines.history.saveError')) }
    const body = { status, given_at: at.toISOString(), note, ...(status === 'given' && n !== undefined ? { amount: n } : {}) }
    if (dose) fix.mutate({ medicineId: medicine.id, doseId: dose.id, ...body }, done)
    else record.mutate({ id: crypto.randomUUID(), medicine_id: medicine.id, ...body }, done)
  }

  return (
    <Sheet title={t(dose ? 'medicines.history.editTitle' : 'medicines.history.addTitle')} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="dose-form-when" className="block text-sm font-extrabold text-muted">
            {t('medicines.history.form.when')}
          </label>
          <Input id="dose-form-when" type="datetime-local" value={when} max={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} />
        </div>
        <ChipGroup label={t('medicines.history.form.status')}>
          <Chip pressed={status === 'given'} onClick={() => setStatus('given')}>
            {t('medicines.history.given')}
          </Chip>
          <Chip pressed={status === 'skipped'} onClick={() => setStatus('skipped')}>
            {t('medicines.history.skipped')}
          </Chip>
        </ChipGroup>
        {status === 'given' && (
          <div className="space-y-1">
            <label htmlFor="dose-form-amount" className="block text-sm font-extrabold text-muted">
              {t('medicines.history.form.amount')}
            </label>
            <div className="flex items-center gap-2">
              <Input id="dose-form-amount" type="number" inputMode="decimal" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              {medicine.dose_unit && <span className="font-bold text-muted">{medicine.dose_unit}</span>}
            </div>
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="dose-form-note" className="block text-sm font-extrabold text-muted">
            {t('medicines.history.form.note')}
          </label>
          <Input id="dose-form-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={saving}>
          {t('medicines.history.form.save')}
        </Button>
      </form>
    </Sheet>
  )
}

/** Every dose of one medicine in the last 30 days. Everyone can look; the admin can add, fix and delete. */
export default function DoseHistory({ medicine, canEdit, onClose }: { medicine: Medicine; canEdit: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const history = useDoseHistory(medicine.id)
  const undo = useUndoDose()
  const [form, setForm] = useState<{ dose?: DoseRow } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const rows = Array.isArray(history.data) ? history.data : []

  return (
    <Sheet variant="full" title={t('medicines.history.title')} onClose={onClose}>
      <p className="text-lg font-extrabold">{medicine.name}</p>
      {canEdit && (
        <Button className="w-full" onClick={() => setForm({})}>
          {t('medicines.history.add')}
        </Button>
      )}
      {history.isSuccess && rows.length === 0 && <p className="text-sm text-muted">{t('medicines.history.empty')}</p>}
      <ul className="space-y-3">
        {rows.map((d) => (
          <li key={d.id}>
            <Card className="space-y-1 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-bold">{formatWhen(d.given_at)}</span>
                <span className="text-sm font-extrabold text-med-ink">
                  {d.status === 'given' ? (d.amount != null ? formatDose(d.amount, medicine.dose_unit ?? '', t) : t('medicines.history.given')) : t('medicines.history.skipped')}
                </span>
              </div>
              <p className="text-sm text-muted">{[t('medicines.history.by', { name: d.by_name }), d.note].filter(Boolean).join(' · ')}</p>
              {canEdit && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {confirming === d.id ? (
                    <>
                      <Button
                        variant="danger"
                        onClick={() => undo.mutate({ medicineId: medicine.id, doseId: d.id }, { onSuccess: () => setConfirming(null) })}
                      >
                        {t('medicines.history.confirmDelete')}
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(null)}>
                        {t('medicines.history.keep')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="soft" onClick={() => setForm({ dose: d })}>
                        {t('medicines.history.edit')}
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(d.id)}>
                        {t('medicines.history.delete')}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
      {form && <DoseForm key={form.dose?.id ?? 'new'} medicine={medicine} dose={form.dose} onClose={() => setForm(null)} />}
    </Sheet>
  )
}
