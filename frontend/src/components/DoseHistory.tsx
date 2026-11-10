import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useDoseHistory, type DoseRow, type Medicine, type Slot } from '../api/hooks'
import { useFixDose, useRecordPastDose, useUndoDose } from '../hooks/log'
import { groupDoses } from '../lib/doseGroups'
import { formatTime, toLocalInput } from '../lib/time'
import { formatDose } from '../lib/units'
import Sheet from './Sheet'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Chip, ChipGroup } from './ui/chip'
import { Input, Select } from './ui/field'
import { DateTimeField } from './ui/datetime'

const sameMoment = (a?: string | null, b?: string | null) => !!a && !!b && Date.parse(a) === Date.parse(b)

/** "12:00 PM (yesterday)" for a dose slot. */
function slotLabel(due: string, t: (k: string) => string): string {
  const day = new Date(due).toDateString() === new Date().toDateString() ? t('medicines.today') : t('medicines.yesterday')
  return `${formatTime(due)} (${day})`
}

/** Add a past dose, or fix an existing one (admin). */
export function DoseForm({ medicine, dose, onClose }: { medicine: Medicine; dose?: DoseRow; onClose: () => void }) {
  const { t } = useTranslation()
  const record = useRecordPastDose()
  const fix = useFixDose()
  const [when, setWhen] = useState(() => toLocalInput(dose ? new Date(dose.given_at) : new Date()))
  const [status, setStatus] = useState<'given' | 'skipped'>(dose?.status ?? 'given')
  const [amount, setAmount] = useState(dose?.amount != null ? String(dose.amount) : medicine.dose_amount != null && !dose ? String(medicine.dose_amount) : '')
  const [note, setNote] = useState(dose?.note ?? '')
  const [error, setError] = useState('')
  // which dose slot this counts for: the slots now open for this medicine, plus the one it is on already
  const slots: Pick<Slot, 'due_at' | 'status'>[] = medicine.schedule_kind === 'as_needed' ? [] : [...medicine.slots]
  if (dose?.scheduled_for && !slots.some((s) => sameMoment(s.due_at, dose.scheduled_for))) slots.push({ due_at: dose.scheduled_for, status: 'given' })
  slots.sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))
  const originalSlot = slots.find((s) => sameMoment(s.due_at, dose?.scheduled_for))?.due_at ?? ''
  const [slotValue, setSlotValue] = useState(() =>
    dose
      ? originalSlot
      : ([...slots].reverse().find((s) => (s.status === 'pending' || s.status === 'partial') && Date.parse(s.due_at) <= Date.now())?.due_at ?? ''),
  )
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
    if (dose) fix.mutate({ medicineId: medicine.id, doseId: dose.id, ...body, ...(slotValue !== originalSlot ? { scheduled_for: slotValue || null } : {}) }, done)
    else record.mutate({ id: crypto.randomUUID(), medicine_id: medicine.id, ...body, ...(slotValue ? { scheduled_for: slotValue } : {}) }, done)
  }

  return (
    <Sheet tone="med" title={t(dose ? 'medicines.history.editTitle' : 'medicines.history.addTitle')} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="dose-form-when" className="block text-[13px] font-semibold text-muted">
            {t('medicines.history.form.when')}
          </label>
          <DateTimeField id="dose-form-when" label={t('medicines.history.form.when')} value={when} onChange={setWhen} />
        </div>
        <ChipGroup label={t('medicines.history.form.status')}>
          <Chip pressed={status === 'given'} onClick={() => setStatus('given')}>
            {t('medicines.history.given')}
          </Chip>
          <Chip pressed={status === 'skipped'} onClick={() => setStatus('skipped')}>
            {t('medicines.history.skipped')}
          </Chip>
        </ChipGroup>
        {slots.length > 0 && (
          <div className="space-y-1">
            <label htmlFor="dose-form-slot" className="block text-[13px] font-semibold text-muted">
              {t('medicines.history.form.slot')}
            </label>
            <Select id="dose-form-slot" value={slotValue} onChange={(e) => setSlotValue(e.target.value)}>
              <option value="">{t('medicines.history.noSlot')}</option>
              {slots.map((sl) => (
                <option key={sl.due_at} value={sl.due_at}>
                  {slotLabel(sl.due_at, t)}
                </option>
              ))}
            </Select>
          </div>
        )}
        {status === 'given' && (
          <div className="space-y-1">
            <label htmlFor="dose-form-amount" className="block text-[13px] font-semibold text-muted">
              {t('medicines.history.form.amount')}
            </label>
            <div className="flex items-center gap-2">
              <Input id="dose-form-amount" type="number" inputMode="decimal" step="any" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              {medicine.dose_unit && <span className="font-bold text-muted">{medicine.dose_unit}</span>}
            </div>
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor="dose-form-note" className="block text-[13px] font-semibold text-muted">
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

const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString()

/** "Today", "Yesterday" or "Sun, 8 Nov" for the heading of a day of doses. */
function dayHeading(iso: string, t: (k: string) => string): string {
  if (sameDay(iso, new Date().toISOString())) return t('medicines.history.dayToday')
  if (sameDay(iso, new Date(Date.now() - 86_400_000).toISOString())) return t('medicines.history.dayYesterday')
  return new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * Every dose of one medicine in the last 30 days, grouped by the time each dose was for. Everyone can look; the admin can
 * add, fix and delete. `header` (the medicine's details and its own actions) sits under the name.
 */
export default function DoseHistory({ medicine, canEdit, onClose, header }: { medicine: Medicine; canEdit: boolean; onClose: () => void; header?: ReactNode }) {
  const { t } = useTranslation()
  const history = useDoseHistory(medicine.id)
  const undo = useUndoDose()
  const [form, setForm] = useState<{ dose?: DoseRow } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const rows = Array.isArray(history.data) ? history.data : []
  const days = groupDoses(rows)
  const amountOf = (d: DoseRow) =>
    d.status === 'given' ? (d.amount != null ? formatDose(d.amount, medicine.dose_unit ?? '', t) : t('medicines.history.given')) : t('medicines.history.skipped')

  return (
    <Sheet tone="med" variant="full" title={t('medicines.history.title')} onClose={onClose}>
      <p className="text-base font-bold">{medicine.name}</p>
      {header}
      {canEdit && (
        <Button className="w-full" onClick={() => setForm({})}>
          {t('medicines.history.add')}
        </Button>
      )}
      {history.isSuccess && rows.length === 0 && <p className="text-sm text-muted">{t('medicines.history.empty')}</p>}
      {days.map((day) => (
        <section key={day.day} aria-label={dayHeading(day.at, t)} className="space-y-2">
          <h3 className="pt-1 text-sm font-bold text-muted">{dayHeading(day.at, t)}</h3>
          <ul className="space-y-3">
            {day.groups.map((g) => (
              <li key={g.rows[0]!.id}>
                <Card className="space-y-2 p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-lg font-bold">{formatTime(g.at)}</span>
                    {g.rows.length > 1 && (
                      <span className="text-sm font-bold text-med-ink">
                        {g.allSkipped ? t('medicines.history.skipped') : formatDose(g.total, medicine.dose_unit ?? '', t)}
                      </span>
                    )}
                  </div>
                  <ul className="divide-y divide-line">
                    {g.rows.map((d) => (
                      <li key={d.id} className="space-y-1 py-2 first:pt-0 last:pb-0">
                        <p className="font-semibold">{amountOf(d)}</p>
                        <p className="text-xs text-muted">
                          {[
                            g.slot ? t('medicines.history.logged', { time: loggedAt(d.given_at, g.at) }) : '',
                            t('medicines.history.by', { name: d.by_name }),
                            d.note,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
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
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {form && <DoseForm key={form.dose?.id ?? 'new'} medicine={medicine} dose={form.dose} onClose={() => setForm(null)} />}
    </Sheet>
  )
}

/** When a dose was logged, as seen from the time it was for: just the time on the same day, else with the date. */
function loggedAt(givenAt: string, reference: string): string {
  return sameDay(givenAt, reference) ? formatTime(givenAt) : `${new Date(givenAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${formatTime(givenAt)}`
}
